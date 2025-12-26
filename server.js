// =================================================================
//                    ФИНАЛЬНЫЙ КОД ДЛЯ SERVER.JS
// =================================================================

// ---------------------------------
// 1. ИМПОРТЫ МОДУЛЕЙ
// ---------------------------------
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto'; // Для создания уникальных ID игр
import { Chess } from 'chess.js'; // УБЕДИТЕСЬ, ЧТО ЭТА БИБЛИОТЕКА УСТАНОВЛЕНА (npm install chess.js)

// ---------------------------------
// 2. ИМПОРТЫ ВАШИХ ФАЙЛОВ
// ---------------------------------
 import { Tournament } from './tournament-logic.js'; // Раскомментируйте, когда будет готово
 import { Game } from './game-logic.js'; // Старая логика игры, мы ее встроили в сервер
import {
    addUser,
    findUserByUsername,
    findUserById,
    comparePasswords,
    updateUserStats,
    updateUserLevel
} from './database.js';

// ---------------------------------
// 3. НАСТРОЙКА СЕРВЕРА И ПЕРЕМЕННЫЕ
// ---------------------------------
const JWT_SECRET = 'yoursupersecretandlongkeyforjwt'; // ВАШ СЕКРЕТНЫЙ КЛЮЧ
const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 3000;
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Для разработки. В продакшене лучше указать ваш домен.
        methods: ["GET", "POST"]
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------
// 4. ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ДЛЯ ИГРЫ
// ---------------------------------
const matchmakingQueue = [];
const activeGames = new Map();
// const mainTournament = new Tournament(io); // Раскомментируйте, когда будет готово
const levels = ['Новичок', 'Любитель', 'Опытный', 'Мастер', 'Грандмастер'];

// ---------------------------------
// 5. MIDDLEWARE (ПРОМЕЖУТОЧНОЕ ПО)
// ---------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const authenticateToken = (req, res, next) => {
    console.log(`\n--- [SERVER LOG] Начало проверки токена для пути: ${req.originalUrl} ---`);
    const authHeader = req.headers['authorization'];
    console.log('[SERVER LOG] 1. Получен заголовок Authorization:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('[SERVER LOG] ОШИБКА: Заголовок отсутствует или имеет неверный формат. Отправляю 401.');
        return res.status(401).json({ message: 'Заголовок Authorization отсутствует или неверен' });
    }

    const token = authHeader.split(' ')[1];
    console.log('[SERVER LOG] 2. Извлечен токен:', token);

    if (!token || token === 'null' || token === 'undefined') {
        console.log('[SERVER LOG] ОШИБКА: Токен пустой. Отправляю 401.');
        return res.status(401).json({ message: 'Токен не предоставлен' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('[SERVER LOG] 3. ОШИБКА ВЕРИФИКАЦИИ ТОКЕНА!', err.name, err.message);
            console.log('[SERVER LOG] Отправляю 403 Forbidden. Токен недействителен или истек.');
            return res.status(403).json({ message: 'Токен недействителен или истек', error: err.message });
        }

        console.log('[SERVER LOG] 3. Верификация токена прошла успешно.');
        console.log('[SERVER LOG] 4. Данные из токена (payload):', user);
        req.user = user;
        next();
    });
};

// ---------------------------------
// 6. API РОУТЫ (РЕГИСТРАЦИЯ, ВХОД, ПРОФИЛЬ)
// ---------------------------------
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) {
        return res.status(400).json({ message: 'Имя пользователя и пароль (мин. 4 символа) обязательны' });
    }
    try {
        const existingUser = await findUserByUsername(username);
        if (existingUser) {
            return res.status(409).json({ message: 'Пользователь с таким именем уже существует' });
        }
        await addUser(username, password);
        res.status(201).json({ message: 'Регистрация прошла успешно' });
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    console.log('Начало обработки /api/login');
    try {
        const { username, password } = req.body;
        console.log(`Получены данные: username=${username}`);
        const user = await findUserByUsername(username);
        console.log('Результат findUserByUsername:', user);

        if (!user) {
            console.log('Пользователь НЕ найден. Отправка 401.');
            return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
        }

        const passwordsMatch = await comparePasswords(password, user.password_hash);
        console.log('Результат comparePasswords:', passwordsMatch);
        if (!passwordsMatch) {
            console.log('Пароли НЕ совпали. Отправка 401.');
            return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
        }

        console.log(`Аутентификация успешна. Генерируем токен для userId: ${user.id}`);
        const payload = { id: user.id, username: user.username };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

        res.status(200).json({
            message: 'Вход выполнен успешно',
            token: token
        });

    } catch (error) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА в /api/login:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const userProfile = await findUserById(req.user.id);
        if (!userProfile) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }
        res.json(userProfile);
    } catch (error) {
        console.error('Критическая ошибка в /api/profile:', error);
        res.status(500).json({ message: 'Ошибка при получении профиля' });
    }
});

app.post('/api/user/level', authenticateToken, async (req, res) => {
    const { level } = req.body;
    const userId = req.user.id;
    const validLevels = ['Новичок', 'Любитель', 'Профессионал', 'Эксперт', 'Мастер'];

    if (!level || !validLevels.includes(level)) {
        console.error(`Получено недопустимое значение уровня: ${level}`);
        return res.status(400).json({ message: 'Недопустимое значение уровня' });
    }

    try {
        const result = await updateUserLevel(userId, level);
        if (result.success) {
            console.log(`API: Уровень для пользователя ${userId} успешно обновлен на ${level}`);
            res.status(200).json({ message: 'Уровень успешно обновлен', skillLevel: level });
        } else {
            console.error(`API: Не удалось обновить уровень для пользователя ${userId}. Причина: ${result.message}`);
            res.status(404).json({ message: result.message }); // 'Пользователь не найден'
        }
    } catch (error) {
        console.error('Ошибка при вызове updateUserLevel:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/logout', (req, res) => {
    res.status(200).json({ message: 'Выход выполнен успешно' });
});

// ---------------------------------
// 7. ЛОГИКА SOCKET.IO
// ---------------------------------

// Middleware для аутентификации сокетов
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error: No token provided'));
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        socket.user = { id: payload.id, username: payload.username };
        next();
    } catch (err) {
        return next(new Error('Authentication error: Invalid token'));
    }
});

// Обработчик подключений
io.on('connection', (socket) => {
    console.log(`[Socket.IO] Подключился ${socket.user.username}`);

    // ----- ЛОГИКА ОБЫЧНОГО МАТЧМЕЙКИНГА 1 НА 1 -----
    socket.on('findGame', () => {
        console.log(`[Socket.IO] ${socket.user.username} ищет игру`);

        const indexInQueue = matchmakingQueue.findIndex(s => s.user.id === socket.user.id);
        if (indexInQueue !== -1) {
             matchmakingQueue.splice(indexInQueue, 1);
        }
        matchmakingQueue.push(socket);

        if (matchmakingQueue.length >= 2) {
            console.log('[Matchmaking] Найдены игроки. Создание игры...');
            const player1Socket = matchmakingQueue.shift();
            const player2Socket = matchmakingQueue.shift();

            // Назначаем цвета случайным образом
            const isPlayer1White = Math.random() < 0.5;
            const whitePlayer = isPlayer1White ? player1Socket : player2Socket;
            const blackPlayer = isPlayer1White ? player2Socket : player1Socket;

            const roomId = `game_${randomUUID()}`;

            const gameRoom = {
                id: roomId,
                players: {
                    white: { socket: whitePlayer, user: whitePlayer.user },
                    black: { socket: blackPlayer, user: blackPlayer.user }
                },
                game: new Chess() // Создаем новый экземпляр игры для этой комнаты
            };
            activeGames.set(roomId, gameRoom);

            whitePlayer.join(roomId);
            blackPlayer.join(roomId);

            console.log(`[GAME START] Игра создана: ${roomId}. Белые: ${whitePlayer.user.username}, Черные: ${blackPlayer.user.username}`);

            whitePlayer.emit('gameStart', { color: 'w', opponent: blackPlayer.user.username, roomId: roomId, fen: gameRoom.game.fen() });
            blackPlayer.emit('gameStart', { color: 'b', opponent: whitePlayer.user.username, roomId: roomId, fen: gameRoom.game.fen() });
        }
    });

    socket.on('cancelFindGame', () => {
        const index = matchmakingQueue.findIndex(s => s.id === socket.id);
        if (index !== -1) {
            matchmakingQueue.splice(index, 1);
            console.log(`[Socket.IO] ${socket.user.username} отменил поиск игры.`);
        }
    });

    // ----- ЛОГИКА ТУРНИРА (заглушки) -----
    socket.on('tournament:join', () => {
        console.log(`[Socket.IO] ${socket.user.username} пытается присоединиться к турниру`);
        // mainTournament.addPlayer(socket);
    });

    socket.on('tournament:leave', () => {
        // mainTournament.removePlayer(socket);
    });

    socket.on('tournament:start', () => {
        console.log(`[Socket.IO] Получена команда на старт турнира от ${socket.user.username}`);
        // mainTournament.start();
    });

    socket.on('tournament:getState', () => {
        // mainTournament.broadcastUpdate();
    });

    // ----- ОБЩАЯ ЛОГИКА ДЛЯ ВСЕХ ИГР -----


// ----- СКОПИРУЙТЕ И ЗАМЕНИТЕ ВЕСЬ ЭТОТ БЛОК -----


// =======================================================================
//   СКОПИРУЙТЕ И ЗАМЕНИТЕ ВЕСЬ БЛОК `socket.on('move', ...)` НА ЭТОТ
// =======================================================================

socket.on('move', (data) => {
    try {
        if (!data || !data.roomId) {
            console.error('[MOVE ERROR] От клиента не пришел ID комнаты.');
            return socket.emit('error', { message: 'От клиента не пришел ID комнаты.' });
        }

        const gameRoom = activeGames.get(data.roomId);
        if (!gameRoom) {
            return socket.emit('error', { message: 'Игра не найдена.' });
        }

        let playerColor = null;
        if (gameRoom.players.white && gameRoom.players.white.socket.id === socket.id) {
            playerColor = 'w';
        } else if (gameRoom.players.black && gameRoom.players.black.socket.id === socket.id) {
            playerColor = 'b';
        }

        if (!playerColor) {
            console.error(`[MOVE ERROR] Игрок ${socket.id} не найден в комнате ${data.roomId}`);
            return socket.emit('error', { message: 'Вы не состоите в этой игре.' });
        }

        const game = gameRoom.game; // game - это экземпляр new Chess()

        if (game.turn() !== playerColor) {
            console.warn(`[MOVE WARN] Игрок ${socket.id} (${playerColor}) попытался сходить не в свою очередь (ход ${game.turn()}).`);
            return socket.emit('invalidMove');
        }

        const moveResult = game.move(data.move);

        if (moveResult === null) {
            console.warn(`[MOVE WARN] Невалидный ход от ${socket.id}:`, data.move);
            return socket.emit('invalidMove');
        }

        console.log(`[GAME] В комнате ${data.roomId} сделан ход: ${moveResult.from}-${moveResult.to}.`);

        const gameState = { fen: game.fen(), pgn: game.pgn() };
        io.to(data.roomId).emit('gameStateUpdate', gameState);

        // --- ПОЛНЫЙ И ИСПРАВЛЕННЫЙ БЛОК ПРОВЕРКИ КОНЦА ИГРЫ ---
        if (game.isGameOver()) {
            let resultType = 'draw';
            let reason = 'Ничья';
            let winnerUsername = null;

            if (game.isCheckmate()) {
                resultType = 'checkmate';
                const winnerPlayer = playerColor === 'w' ? gameRoom.players.white : gameRoom.players.black;
                winnerUsername = winnerPlayer.user ? winnerPlayer.user.username : 'Игрок';
                reason = `Шах и мат!`;
            } else if (game.isStalemate()) {
                resultType = 'stalemate';
                reason = 'Пат. Ничья.';
            } else if (game.isThreefoldRepetition()) {
                resultType = 'draw';
                reason = 'Ничья из-за троекратного повторения.';
            } else if (game.isInsufficientMaterial()) {
                resultType = 'draw';
                reason = 'Ничья из-за недостатка материала.';
            }

            console.log(`[GAME OVER] Комната ${data.roomId}. Тип: ${resultType}, Победитель: ${winnerUsername || 'нет'}`);

            // Отправляем результат всем в комнате
            io.to(data.roomId).emit('gameOver', {
                type: resultType,
                winner: winnerUsername,
                reason: reason,
                fen: game.fen()
            });

            // Удаляем игру из активных
            activeGames.delete(data.roomId);
        }
        // --- КОНЕЦ ИСПРАВЛЕННОГО БЛОКА ---

    } catch (error) {
        console.error(`[MOVE FATAL ERROR] Критическая ошибка при обработке хода в комнате ${data.roomId || 'unknown'}:`, error);
        socket.emit('error', { message: 'Произошла внутренняя ошибка сервера.' });
    }
});

// =======================================================================
//   УБЕДИТЕСЬ, ЧТО ВАШ КОД `socket.on('disconnect', ...)` НАЧИНАЕТСЯ ПОСЛЕ ЭТОЙ СТРОКИ
// =======================================================================

    // ----- ОБРАБОТЧИК ОТСОЕДИНЕНИЯ -----
    socket.on('disconnect', () => {
        console.log(`[Socket.IO] Пользователь отключился: ${socket.user.username} (ID: ${socket.id})`);

        // Удаление из очереди поиска
        const queueIndex = matchmakingQueue.findIndex(s => s.id === socket.id);
        if (queueIndex !== -1) {
            matchmakingQueue.splice(queueIndex, 1);
            console.log(`[QUEUE] Игрок ${socket.user.username} удален из очереди.`);
        }

        // Обработка прерывания активной игры
        for (const [roomId, gameRoom] of activeGames.entries()) {
            const { white: whitePlayer, black: blackPlayer } = gameRoom.players;
            let opponentSocket = null;
            let winnerUsername = null;

            if (whitePlayer && whitePlayer.socket.id === socket.id) {
                opponentSocket = blackPlayer ? blackPlayer.socket : null;
                winnerUsername = blackPlayer ? blackPlayer.user.username : null;
            } else if (blackPlayer && blackPlayer.socket.id === socket.id) {
                opponentSocket = whitePlayer ? whitePlayer.socket : null;
                winnerUsername = whitePlayer ? whitePlayer.user.username : null;
            }

            if (opponentSocket) {
                console.log(`[GAME ABORT] Игрок ${socket.user.username} покинул игру ${roomId}.`);
                opponentSocket.emit('gameOver', {
                    type: 'abandonment',
                    winner: winnerUsername,
                    reason: 'Соперник отключился'
                });
                activeGames.delete(roomId);
                break; // Выходим из цикла, т.к. игрок может быть только в одной игре
            }
        }
    });

});

// ---------------------------------
// 8. ЗАПУСК СЕРВЕРА
// ---------------------------------
const startServer = async () => {
    httpServer.listen(port, () => {
        console.log(`🚀 Сервер запущен на http://localhost:${port}`);
    });
};

startServer();
