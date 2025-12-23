// ==========================================================
// ФИНАЛЬНЫЙ SERVER.JS, СОВМЕСТИМЫЙ С ВАШИМ DATABASE.JS
// ==========================================================

import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs'; // <--- ВОТ ЭТА СТРОКА НУЖНА


// ИМПОРТЫ ИЗ ВАШИХ ФАЙЛОВ
import { Game } from './game-logic.js'; // Используем ваше имя файла 'gamelogic.js'
import {
    initDb,
    addUser,
    findUserByUsername,
    findUserById,
    comparePasswords,
    updateUserStats,
    updateUserLevel // Ваша функция для обновления уровня!
} from './database.js';

// --- 1. НАСТРОЙКА EXPRESS И HTTP/SOCKET.IO СЕРВЕРА ---
const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 3000;
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 2. MIDDLEWARE (ПРОМЕЖУТОЧНОЕ ПО) ---
app.use(express.json());
const sessionMiddleware = session({
    secret: 'a-very-strong-and-secret-key-for-chess',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));
io.use(async (socket, next) => {
    const session = socket.request.session;
    if (session && session.userId) {
        try {
            const user = await findUserById(session.userId);
            if (user) {
                socket.user = user;
                next();
            } else {
                next(new Error('unauthorized: user not found'));
            }
        } catch (error) {
            console.error('Socket Auth Error:', error);
            next(new Error('server error during auth'));
        }
    } else {
        next(new Error('unauthorized: no session'));
    }
});

// --- 3. API РОУТЫ ДЛЯ EXPRESS ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) {
        return res.status(400).json({ message: 'Имя пользователя и пароль (мин 4 символа) обязательны' });
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
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Имя пользователя и пароль обязательны' });
        }

        const user = await findUserByUsername(username);
        if (!user) {
            return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
        }

        // ИЗМЕНЕНО: Сравниваем с user.password_hash, как в вашем database.js
        const isPasswordMatch = await comparePasswords(password, user.password_hash);
        if (!isPasswordMatch) {
            return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
        }

        req.session.userId = user.id;
        // Отправляем на клиент безопасные данные пользователя
        const safeUserData = { id: user.id, username: user.username, wins: user.wins, losses: user.losses, draws: user.draws, level: user.level };
        res.status(200).json({ user: safeUserData });

    } catch (err) {
        console.error('Ошибка на /api/login:', err);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/session', async (req, res) => {
    if (req.session && req.session.userId) {
        try {
            const user = await findUserById(req.session.userId);
            if (user) {
                // ИСПРАВЛЕНО: Отправляем сам объект пользователя, а не объект с пользователем внутри
                res.status(200).json(user);
            } else {
                 res.status(401).json({ message: 'Сессия недействительна' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    } else {
        res.status(401).json({ message: 'Сессия не найдена' });
    }
});

// ПРАВИЛЬНЫЙ КОД для server.js
app.post('/api/user/level', async (req, res) => { // Добавляем async, так как работа с файлами асинхронна
    const { level } = req.body;
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'Пользователь не авторизован' });
    }

    try {
        // Используем новую функцию из database.js!
        await updateUserLevel(userId, level);
        res.json({ success: true, message: 'Уровень успешно обновлен' });
    } catch (error) {
        console.error('Ошибка при обновлении уровня в server.js:', error);
        res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера при обновлении уровня' });
    }
});

// ... остальной код вашего server.js (прослушивание порта и т.д.) ...

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) { return res.status(500).json({ message: 'Не удалось выйти.' }); }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Выход выполнен успешно.' });
    });
});

// --- 4. ЛОГИКА ИГРЫ И SOCKET.IO ---

let waitingPlayer = null;
const activeGames = new Map();
// ДОБАВЛЕНО: Система уровней, как в вашей БД
const levels = ['Новичок', 'Любитель', 'Опытный', 'Мастер', 'Грандмастер'];

// ДОБАВЛЕНО И ИЗМЕНЕНО: Центральная функция для обработки конца игры с логикой расчета уровня
async function handleGameEnd(winnerId, loserId, isDraw) {
    try {
        // 1. Обновляем статистику (победы/поражения/ничьи)
        await updateUserStats(winnerId, loserId, isDraw);
        console.log(`[System] Статистика для игроков обновлена.`);

        if (isDraw) return; // При ничьей уровень не меняем

        // 2. Получаем текущие данные игроков для расчета нового уровня
        const winner = await findUserById(winnerId);
        const loser = await findUserById(loserId);
        if (!winner || !loser) return;

        // 3. Логика повышения уровня для победителя
        const currentWinnerLevelIndex = levels.indexOf(winner.level);
        // Если игрок еще не на максимальном уровне
        if (currentWinnerLevelIndex < levels.length - 1) {
            // Упрощенная логика: повышаем уровень, если победили игрока того же или более высокого уровня
            const currentLoserLevelIndex = levels.indexOf(loser.level);
            if (currentLoserLevelIndex >= currentWinnerLevelIndex) {
                 const newWinnerLevel = levels[currentWinnerLevelIndex + 1];
                 await updateUserLevel(winnerId, newWinnerLevel); // Вызываем вашу функцию
                 console.log(`[System] Уровень игрока ${winner.username} повышен до ${newWinnerLevel}`);
            }
        }

        // 4. Логика понижения уровня для проигравшего (опционально)
        const currentLoserLevelIndex = levels.indexOf(loser.level);
        if (currentLoserLevelIndex > 0) {
            // Упрощенная логика: понижаем уровень при проигрыше игроку того же или более низкого уровня
            if (currentWinnerLevelIndex <= currentLoserLevelIndex) {
                const newLoserLevel = levels[currentLoserLevelIndex - 1];
                await updateUserLevel(loserId, newLoserLevel); // Вызываем вашу функцию
                console.log(`[System] Уровень игрока ${loser.username} понижен до ${newLoserLevel}`);
            }
        }

    } catch(error) {
        console.error(`[System] Ошибка при обновлении данных после игры:`, error);
    }
}

function createAndStartGame(player1, player2) {
    const gameId = `game-${Date.now()}`;
    const onGameEnd = (endedGameId) => {
        activeGames.delete(endedGameId);
        console.log(`[System] Игра ${endedGameId} удалена из активных.`);
    };
    const onRematchAccepted = (p1, p2) => {
        console.log(`[System] Реванш принят между ${p1.user.username} и ${p2.user.username}.`);
        createAndStartGame(p2, p1);
    };

    const game = new Game(gameId, player1, player2, io, onGameEnd, handleGameEnd, onRematchAccepted);
    activeGames.set(gameId, game);
    player1.socket.join(gameId);
    player2.socket.join(gameId);
    game.start();
}

io.on('connection', (socket) => {
    // ... остальная логика io.on('connection') остается без изменений ...
    console.log(`[Socket] Подключился пользователь: ${socket.user.username} (ID: ${socket.id})`);

    socket.on('findGame', () => {
        console.log(`[Socket] ${socket.user.username} ищет игру.`);
        if (waitingPlayer && waitingPlayer.user.id === socket.user.id) {
            socket.emit('status', 'Вы уже в очереди на поиск игры.');
            return;
        }

        if (waitingPlayer) {
            const player1 = waitingPlayer;
            const player2 = { socket, user: socket.user };
            waitingPlayer = null;
            console.log(`[System] Найдена пара: ${player1.user.username} vs ${player2.user.username}`);
            createAndStartGame(player1, player2);
        } else {
            waitingPlayer = { socket, user: socket.user };
            socket.emit('status', 'Поиск соперника...');
        }
    });

    socket.on('makeMove', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) { game.makeMove(socket.id, data.move); }
    });

    socket.on('resign', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) { game.handleResignation(socket.id); }
    });

    socket.on('requestRematch', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) { game.requestRematch(socket.id); }
    });

    socket.on('cancelSearch', () => {
        if (waitingPlayer && waitingPlayer.socket.id === socket.id) {
            waitingPlayer = null;
            console.log(`[System] ${socket.user.username} отменил поиск и удален из очереди.`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Отключился пользователь: ${socket.user.username}`);

        if (waitingPlayer && waitingPlayer.socket.id === socket.id) {
            waitingPlayer = null;
            console.log(`[System] ${socket.user.username} удален из очереди.`);
            return;
        }

        for (const game of activeGames.values()) {
            if (game.getPlayerColor(socket.id)) {
                console.log(`[System] Игрок ${socket.user.username} отключился во время игры ${game.gameId}.`);
                game.handleResignation(socket.id);
                break;
            }
        }
    });
});

// --- 5. ЗАПУСК СЕРВЕРА ---
const startServer = async () => {
    await initDb();
    httpServer.listen(port, () => {
        console.log(`🚀 Сервер запущен на http://localhost:${port}`);
    });
};

startServer();
