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

io.on('connection', (socket) => {
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

    socket.on('joinGame', ({ gameType }) => {
        if (!socket.username) return;

        let targetRoom = Object.values(rooms).find(r => r.gameType === gameType && r.players.length < 2 && !r.started);

        if (!targetRoom) {
            const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
            targetRoom = {
                roomId,
                gameType,
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
            if (targetRoom.gameType === '4ball') {
                targetRoom.balls = [
                    { id: 0, x: 200, y: 200, color: '#fff', radius: 10 },
                    { id: 1, x: 600, y: 200, color: '#f1c40f', radius: 10 },
                    { id: 2, x: 500, y: 180, color: '#e74c3c', radius: 10 },
                    { id: 3, x: 500, y: 220, color: '#e74c3c', radius: 10 }
                ];
            } else {
                targetRoom.balls = [
                    { id: 0, x: 200, y: 200, color: '#fff', radius: 10 },
                    { id: 1, x: 550, y: 200, color: '#f1c40f', radius: 10 },
                    { id: 2, x: 580, y: 185, color: '#3498db', radius: 10 },
                    { id: 3, x: 580, y: 215, color: '#e74c3c', radius: 10 }
                ];
            }
            io.to(targetRoom.roomId).emit('gameStart', {
                gameType: targetRoom.gameType,
                balls: targetRoom.balls,
                turnPlayer: targetRoom.players[0].username
            });
        } else {
            socket.emit('waiting', '상대 플레이어 대기 중...');
        }
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
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버 실행 중: 포트 ${PORT}`);
});
