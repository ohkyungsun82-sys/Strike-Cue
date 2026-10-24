const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');

function loadUsers() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveUsers(users) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

const rooms = {};

function updatePlayerCounts() {
    let counts = { '4ball': 0, 'pocket': 0 };
    Object.values(rooms).forEach(room => {
        if (counts[room.gameType] !== undefined) {
            counts[room.gameType] += room.players.filter(p => p.id !== 'AI_BOT').length;
        }
    });
    io.emit('playerCounts', counts);
}

io.on('connection', (socket) => {
    updatePlayerCounts();

    // 클라이언트가 새로고침 후 자동 로그인할 때 소켓에 username 등록
    socket.on('setSocketUser', (username) => {
        if (username) socket.username = username;
    });

    socket.on('register', ({ username, password }, callback) => {
        if (!username || !password) return callback({ success: false, message: '모든 항목을 입력하세요.' });
        const users = loadUsers();
        if (users[username]) return callback({ success: false, message: '이미 존재하는 아이디입니다.' });
        
        users[username] = {
            password,
            money: 1000,
            wins: 0,
            isAdmin: (username === 'Strike Cue')
        };
        saveUsers(users);
        socket.username = username;
        callback({ success: true, user: { username, money: 1000, isAdmin: users[username].isAdmin } });
    });

    socket.on('login', ({ username, password }, callback) => {
        const users = loadUsers();
        if (!users[username] || users[username].password !== password) {
            return callback({ success: false, message: '아이디 또는 비밀번호가 틀렸습니다.' });
        }
        socket.username = username;
        if (username === 'Strike Cue' && !users[username].isAdmin) {
            users[username].isAdmin = true;
            saveUsers(users);
        }
        callback({ 
            success: true, 
            user: { 
                username, 
                money: users[username].money || 1000, 
                isAdmin: username === 'Strike Cue' 
            } 
        });
    });

    socket.on('getRanking', () => {
        const users = loadUsers();
        const rankList = Object.keys(users).map(name => ({
            username: name,
            money: users[name].money || 1000,
            wins: users[name].wins || 0
        })).sort((a, b) => b.money - a.money).slice(0, 10);
        socket.emit('rankingData', rankList);
    });

    socket.on('joinGame', ({ gameType, isAI }) => {
        if (!socket.username) {
            // 소켓에 유저 이름이 누락된 경우를 대비해 클라이언트 닉네임으로 강제 할당 시도 가능
            return;
        }

        if (isAI) {
            const roomId = 'ai_room_' + Math.random().toString(36).substring(2, 9);
            const aiRoom = {
                roomId,
                gameType,
                isAI: true,
                players: [
                    { id: socket.id, username: socket.username },
                    { id: 'AI_BOT', username: 'AI 당구고수' }
                ],
                started: true,
                turn: 0,
                balls: [
                    { id: 0, x: 200, y: 200, color: '#fff', radius: 10 },
                    { id: 1, x: 600, y: 200, color: '#f1c40f', radius: 10 },
                    { id: 2, x: 500, y: 180, color: '#e74c3c', radius: 10 },
                    { id: 3, x: 500, y: 220, color: '#e74c3c', radius: 10 }
                ]
            };
            rooms[roomId] = aiRoom;
            socket.join(roomId);
            socket.roomID = roomId;

            socket.emit('gameStart', {
                gameType,
                balls: aiRoom.balls,
                turnPlayer: socket.username,
                isAI: true
            });
            updatePlayerCounts();
            return;
        }

        let targetRoom = Object.values(rooms).find(r => !r.isAI && r.gameType === gameType && r.players.length < 2 && !r.started);

        if (!targetRoom) {
            const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
            targetRoom = {
                roomId,
                gameType,
                isAI: false,
                players: [],
                started: false,
                turn: 0,
                balls: []
            };
            rooms[roomId] = targetRoom;
        }

        targetRoom.players.push({ id: socket.id, username: socket.username });
        socket.join(targetRoom.roomId);
        socket.roomID = targetRoom.roomId;

        if (targetRoom.players.length === 2) {
            targetRoom.started = true;
            targetRoom.balls = [
                { id: 0, x: 200, y: 200, color: '#fff', radius: 10 },
                { id: 1, x: 600, y: 200, color: '#f1c40f', radius: 10 },
                { id: 2, x: 500, y: 180, color: '#e74c3c', radius: 10 },
                { id: 3, x: 500, y: 220, color: '#e74c3c', radius: 10 }
            ];
            io.to(targetRoom.roomId).emit('gameStart', {
                gameType: targetRoom.gameType,
                balls: targetRoom.balls,
                turnPlayer: targetRoom.players[0].username,
                isAI: false
            });
        } else {
            socket.emit('waiting', '상대 플레이어 대기 중...');
        }
        updatePlayerCounts();
    });

    socket.on('shoot', ({ power, angle }) => {
        const room = rooms[socket.roomID];
        if (!room || !room.started) return;

        const currentTurnPlayer = room.players[room.turn % room.players.length];
        if (currentTurnPlayer.id !== socket.id && currentTurnPlayer.id !== 'AI_BOT') return;

        io.to(room.roomId).emit('shotResult', { power, angle, shooter: currentTurnPlayer.username });

        room.turn++;
        const nextTurnPlayer = room.players[room.turn % room.players.length];
        
        setTimeout(() => {
            io.to(room.roomId).emit('changeTurn', { turnPlayer: nextTurnPlayer.username });

            if (room.isAI && nextTurnPlayer.id === 'AI_BOT') {
                setTimeout(() => {
                    const isWorst = Math.random() < 0.7;
                    const aiPower = isWorst ? Math.random() * 2 : 15 + Math.random() * 5;
                    const aiAngle = isWorst ? Math.random() * Math.PI * 2 : 0;

                    io.to(room.roomId).emit('shotResult', { power: aiPower, angle: aiAngle, shooter: 'AI 당구고수' });

                    room.turn++;
                    const backToUser = room.players[room.turn % room.players.length];
                    setTimeout(() => {
                        io.to(room.roomId).emit('changeTurn', { turnPlayer: backToUser.username });
                    }, 2000);
                }, 1500);
            }
        }, 2000);
    });

    socket.on('gameOverAndWin', () => {
        if (!socket.username) return;
        const users = loadUsers();
        if (users[socket.username]) {
            users[socket.username].money = (users[socket.username].money || 1000) + 500000;
            users[socket.username].wins = (users[socket.username].wins || 0) + 1;
            saveUsers(users);
            socket.emit('moneyUpdate', users[socket.username].money);
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomID && rooms[socket.roomID]) {
            const room = rooms[socket.roomID];
            io.to(room.roomId).emit('opponentDisconnected');
            delete rooms[socket.roomID];
        }
        updatePlayerCounts();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버 실행 중: 포트 ${PORT}`);
});
