// НАЧАЛО ФАЙЛА game-logic.js (скопируйте всё отсюда)

import { Chess } from 'chess.js';

export class Game {

    constructor(gameId, player1, player2, io, onGameEnd, gameResultCallback, onRematchAccepted) {
        this.gameId = gameId;
        this.io = io;
        this.chess = new Chess();
        this.isGameOver = false;

        this.onGameEnd = onGameEnd;
        this.gameResultCallback = gameResultCallback;
        this.onRematchAccepted = onRematchAccepted;

        const isPlayer1White = Math.random() < 0.5;
        this.players = {
            white: isPlayer1White ? player1 : player2,
            black: isPlayer1White ? player2 : player1,
        };

        this.rematchRequests = new Set();
        this.cleanupTimeout = null;

        this.start();
    }

    start() {
        console.log(`[Game ${this.gameId}] Начало игры. Белые: ${this.players.white.user.username}, Черные: ${this.players.black.user.username}`);

        this.players.white.socket.join(this.gameId);
        this.players.black.socket.join(this.gameId);

        this.players.white.socket.emit('gameStart', {
            color: 'white',
            roomId: this.gameId,
            opponent: this.players.black.user,
        });

        this.players.black.socket.emit('gameStart', {
            color: 'black',
            roomId: this.gameId,
            opponent: this.players.white.user,
        });

        this.emitGameState('Игра началась!');
    }

    makeMove(socketId, move) {
        if (this.isGameOver) {
            console.log(`[Game ${this.gameId}] Ход отклонен, игра уже окончена.`);
            return;
        }

        const playerColor = this.getPlayerColor(socketId);
        const currentTurn = this.chess.turn() === 'w' ? 'white' : 'black';

        if (playerColor !== currentTurn) {
            console.log(`[Game ${this.gameId}] Неверный ход от ${playerColor}. Сейчас ходят ${currentTurn}.`);
            this.players[playerColor].socket.emit('invalidMove', { message: 'Сейчас не ваш ход' });
            return;
        }

        try {
            const result = this.chess.move(move);
            if (result === null) throw new Error('Недопустимый ход');

            this.emitGameState(`Ход: ${result.san}`);
            this.checkGameOver();

        } catch (error) {
            console.error(`[Game ${this.gameId}] Ошибка при выполнении хода: ${error.message}`);
            this.players[playerColor].socket.emit('invalidMove', { message: 'Недопустимый ход' });
        }
    }


 handleResignation(socketId) {
        if (this.isGameOver) return;
        const resigningColor = this.getPlayerColor(socketId);
        if (!resigningColor) return;

        const winnerColor = resigningColor === 'white' ? 'black' : 'white';
        const winner = this.players[winnerColor];
        const loser = this.players[resigningColor];

        // --- ИСПРАВЛЕНИЕ 1 ---
        // Использованы обратные кавычки (`) для шаблонной строки, а не одинарные (')
        const result = { type: 'resign', winner: winner.user.username, reason: `${loser.user.username} сдался.` };

        // Передаем объект result в endGame
        this.endGame(result, winner.user.id, loser.user.id, false);
    }

    requestRematch(socketId) {
        // --- ИСПРАВЛЕНИЕ 2 ---
        // Реванш можно предложить ТОЛЬКО ПОСЛЕ окончания игры
        if (!this.isGameOver) return;

        const playerColor = this.getPlayerColor(socketId);
        if (!playerColor) return;

        const player = this.players[playerColor];
        const opponent = this.players[playerColor === 'white' ? 'black' : 'white'];

        if (this.rematchRequests.has(player.user.id)) return;

        this.rematchRequests.add(player.user.id);
        console.log(`[Game ${this.gameId}] ${player.user.username} предлагает реванш.`);

        if (this.rematchRequests.has(opponent.user.id)) {
            console.log(`[Game ${this.gameId}] Оба игрока согласились. Создание новой игры.`);

            // --- ИСПРАВЛЕНИЕ 3 ---
            // Немедленно останавливаем таймер удаления старой игры
            clearTimeout(this.cleanupTimeout);

            if (this.onRematchAccepted) {
                // Передаем игроков в обратном порядке для смены цвета
                this.onRematchAccepted(this.players.black, this.players.white);
            }

            // Немедленно удаляем старую игру
            this.cleanup();
        } else {
            // Отправляем предложение второму игроку
            opponent.socket.emit('rematchOffered', { from: player.user.username });
        }
    }

    checkGameOver() {
        if (!this.chess.isGameOver()) return;

        let result, winnerId = null, loserId = null, isDraw = false;

        if (this.chess.isCheckmate()) {
            const winnerColor = this.chess.turn() === 'w' ? 'black' : 'white';
            const loserColor = winnerColor === 'white' ? 'black' : 'white';
            winnerId = this.players[winnerColor].user.id;
            loserId = this.players[loserColor].user.id;
            result = { type: 'checkmate', winner: this.players[winnerColor].user.username, reason: 'Мат!' };
        } else {
            isDraw = true;
            winnerId = this.players.white.user.id;
            loserId = this.players.black.user.id;

            if (this.chess.isStalemate()) result = { type: 'stalemate', reason: 'Пат' };
            else if (this.chess.isThreefoldRepetition()) result = { type: 'draw', reason: 'Ничья (троекратное повторение)' };
            else if (this.chess.isInsufficientMaterial()) result = { type: 'draw', reason: 'Ничья (недостаточно материала)' };
            else result = { type: 'draw', reason: 'Ничья по правилам 50 ходов' };
        }
        this.endGame(result, winnerId, loserId, isDraw);
    }

    endGame(result, winnerId, loserId, isDraw) {
        if (this.isGameOver) return;
        this.isGameOver = true;

        console.log(`[Game ${this.gameId}] Завершена. Результат:`, result);
        this.io.to(this.gameId).emit('gameOver', result);

        if (this.gameResultCallback) {
            this.gameResultCallback(winnerId, loserId, isDraw);
        }

        console.log(`[Game ${this.gameId}] Игра будет удалена из памяти через 20 секунд.`);
        this.cleanupTimeout = setTimeout(() => this.cleanup(), 20000);
    }

    cleanup() {
        console.log(`[Game ${this.gameId}] Очистка и удаление.`);
        clearTimeout(this.cleanupTimeout);

        // Отписываем игроков от комнаты
        if (this.players.white && this.players.white.socket) {
            this.players.white.socket.leave(this.gameId);
        }
        if (this.players.black && this.players.black.socket) {
            this.players.black.socket.leave(this.gameId);
        }

        if (this.onGameEnd) {
            this.onGameEnd(this.gameId);
        }
    }

    getPlayerColor(socketId) {
        if (this.players.white && this.players.white.socket.id === socketId) return 'white';
        if (this.players.black && this.players.black.socket.id === socketId) return 'black';
        return null;
    }

    emitGameState(message = '') {
        const gameState = {
            fen: this.chess.fen(),
            turn: this.chess.turn(),
            history: this.chess.history({ verbose: true }),
            isCheck: this.chess.inCheck(),
            isGameOver: this.isGameOver,
            message: message,
        };

        // Строки для отладки
        console.log(`[Game ${this.gameId}] ОТПРАВКА gameStateUpdate в комнату ${this.gameId}`);
        console.log(`[Game ${this.gameId}] FEN для отправки: ${gameState.fen}`);

        // Отправка обновления состояния всем в комнате
        this.io.to(this.gameId).emit('gameStateUpdate', gameState);
    }
};

// КОНЕЦ ФАЙЛА game-logic.js (копируйте всё досюда)
