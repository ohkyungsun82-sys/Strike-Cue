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
        if (!username || !password) return callback({ success: false, message: '정보를 입력하세요.' });
        const users = loadUsers();
        if (users[username]) return callback({ success: false, message: '이미 존재하는 아이디입니다.' });
        
        users[username] = password;
        saveUsers(users);
        callback({ success: true, message: '회원가입 성공!' });
    });

    socket.on('login', ({ username, password }, callback) => {
        const users = loadUsers();
        if (!users[username] || users[username] !== password) {
            return callback({ success: false, message: '아이디 또는 비밀번호가 틀렸습니다.' });
        }
        socket.username = username;
        callback({ success: true, username });
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
            if (targetRoom.gameType === 'pocket') {
                targetRoom.balls = [
                    { id: 0, x: 200, y: 200, color: 'white', radius: 10 },
                    { id: 1, x: 600, y: 200, color: 'yellow', radius: 10 },
                    { id: 2, x: 620, y: 190, color: 'blue', radius: 10 },
                    { id: 3, x: 620, y: 210, color: 'red', radius: 10 }
                ];
            } else {
                targetRoom.balls = [
                    { id: 0, x: 200, y: 200, color: 'white', radius: 10 },
                    { id: 1, x: 600, y: 200, color: 'yellow', radius: 10 },
                    { id: 2, x: 500, y: 180, color: 'red', radius: 10 },
                    { id: 3, x: 500, y: 220, color: 'red', radius: 10 }
                ];
            }
            io.to(targetRoom.roomId).emit('gameStart', {
                players: targetRoom.players,
                gameType: targetRoom.gameType,
                balls: targetRoom.balls,
                turnPlayer: targetRoom.players[0].username
            });
        } else {
            socket.emit('waiting', '상대 대기중...');
        }
    });

    socket.on('shoot', ({ power, angle }) => {
        const room = rooms[socket.roomID];
        if (!room || !room.started) return;

        const currentTurnPlayer = room.players[room.turn % room.players.length];
        if (currentTurnPlayer.id !== socket.id) return;

        io.to(room.roomId).emit('shotResult', { power, angle, shooter: currentTurnPlayer.username });

        room.turn++;
        const nextTurnPlayer = room.players[room.turn % room.players.length];
        setTimeout(() => {
            io.to(room.roomId).emit('changeTurn', { turnPlayer: nextTurnPlayer.username });
        }, 2000);
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