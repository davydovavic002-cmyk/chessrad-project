// ==========================================================
// ЕДИНЫЙ GAMELOGIC.JS - ФИНАЛЬНАЯ, ЧИСТАЯ И ИСПРАВЛЕННАЯ ВЕРСИЯ
// ==========================================================

import { Chess } from 'chess.js';

export class Game {
    /**
     * @param {string} gameId
     * @param {object} player1 - { socket, user }
     * @param {object} player2 - { socket, user }
     * @param {Server} io - Экземпляр Socket.IO
     * @param {function} onGameEnd - Колбэк для удаления игры из activeGames
     * @param {function} updateStats - Колбэк для обновления статистики в БД
     * @param {function} onRematchAccepted - Колбэк для создания новой игры-реванша
     */
    constructor(gameId, player1, player2, io, onGameEnd, updateStats, onRematchAccepted) {
        this.gameId = gameId;
        this.io = io;
        this.onGameEnd = onGameEnd;
        this.updateStats = updateStats;
        this.onRematchAccepted = onRematchAccepted;

        this.chess = new Chess();
        this.isGameOver = false;

        // Определяем, кто играет каким цветом
        const isPlayer1White = Math.random() < 0.5;
        this.players = {
            white: isPlayer1White ? player1 : player2,
            black: isPlayer1White ? player2 : player1,
        };

        // Хранилище для ID пользователей, запросивших реванш
        this.rematchRequests = new Set();
    }

    /**
     * Начинает игру, рассылает начальное состояние.
     */
    start() {
        console.log(`[Game ${this.gameId}] Начало игры. Белые: ${this.players.white.user.username}, Черные: ${this.players.black.user.username}`);

        // Отправляем каждому игроку информацию о начале игры
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

        this.emitGameState();
    }

    /**
     * Обрабатывает ход игрока.
     * @param {string} socketId - ID сокета игрока, сделавшего ход.
     * @param {object} move - Объект хода (например, { from: 'e2', to: 'e4' }).
     */
    makeMove(socketId, move) {
        if (this.isGameOver) return;

        const playerColor = this.getPlayerColor(socketId);
        if (playerColor !== this.chess.turn()) {
            // Ход не в свою очередь, игнорируем или отправляем ошибку
            console.log(`[Game ${this.gameId}] Попытка хода не в свою очередь от ${playerColor}`);
            return;
        }

        try {
            const result = this.chess.move(move);
            if (result === null) throw new Error('Недопустимый ход');

            this.emitGameState();
            this.checkGameOver();
        } catch (error) {
            console.error(`[Game ${this.gameId}] Ошибка хода:`, error.message);
            // Можно отправить сообщение об ошибке конкретному игроку
            this.io.to(socketId).emit('invalidMove', { message: 'Недопустимый ход' });
        }
    }

    /**
     * Обрабатывает сдачу игрока или его отключение.
     * @param {string} socketId - ID сокета сдавшегося игрока.
     */
    handleResignation(socketId) {
        if (this.isGameOver) return;

        const resigningColor = this.getPlayerColor(socketId);
        if (!resigningColor) return;

        const winnerColor = resigningColor === 'white' ? 'black' : 'white';
        const winner = this.players[winnerColor];
        const loser = this.players[resigningColor];

        const result = {
            type: 'resign',
            winner: winner.user.username,
            loser: loser.user.username,
        };

        this.endGame(result, winner.user.id, loser.user.id, false);
    }

    /**
     * Обрабатывает запрос на реванш от игрока.
     * @param {string} socketId - ID сокета игрока.
     */
    requestRematch(socketId) {
        if (!this.isGameOver) return;

        const player = this.getPlayerColor(socketId) === 'white' ? this.players.white : this.players.black;
        const opponent = this.getPlayerColor(socketId) === 'white' ? this.players.black : this.players.white;

        if (this.rematchRequests.has(player.user.id)) return; // Уже запросил

        this.rematchRequests.add(player.user.id);
        console.log(`[Game ${this.gameId}] ${player.user.username} предлагает реванш.`);

        if (this.rematchRequests.has(opponent.user.id)) {
            // Оба согласились!
            console.log(`[Game ${this.gameId}] Оба игрока согласились на реванш. Создание новой игры.`);
            this.onRematchAccepted(this.players.white, this.players.black);
            this.cleanup(); // Уничтожаем старую игру
        } else {
            // Уведомляем оппонента о предложении
            opponent.socket.emit('rematchOffered');
        }
    }

    /**
     * Проверяет, не закончилась ли игра (мат, пат, ничья).
     */
    checkGameOver() {
        if (!this.chess.isGameOver()) return;

        let result, winnerId = null, loserId = null, isDraw = false;

        if (this.chess.isCheckmate()) {
            const winnerColor = this.chess.turn() === 'w' ? 'black' : 'white';
            const loserColor = this.chess.turn() === 'w' ? 'white' : 'black';
            winnerId = this.players[winnerColor].user.id;
            loserId = this.players[loserColor].user.id;
            result = { type: 'checkmate', winner: this.players[winnerColor].user.username };
        } else {
            isDraw = true;
            if (this.chess.isStalemate()) result = { type: 'stalemate' };
            else if (this.chess.isDraw()) result = { type: 'draw' };
            else result = { type: 'draw', reason: 'threefold repetition' };
        }

        if (result) {
            this.endGame(result, winnerId, loserId, isDraw);
        }
    }

    /**
     * Завершает игру, обновляет статистику и дает время на реванш.
     */
    endGame(result, winnerId, loserId, isDraw) {
        if (this.isGameOver) return;
        this.isGameOver = true;

        console.log(`[Game ${this.gameId}] Завершена. Результат:`, result);
        this.io.to(this.gameId).emit('gameOver', result);

        if (this.updateStats) {
            this.updateStats(winnerId, loserId, isDraw);
        }

        // ДАЕМ ИГРОКАМ 60 СЕКУНД НА РЕВАНШ, ПРЕЖДЕ ЧЕМ УНИЧТОЖИТЬ ИГРУ
        setTimeout(() => {
            if (this.rematchRequests.size < 2) {
                console.log(`[Game ${this.gameId}] Время на реванш истекло, игра удаляется.`);
                this.io.to(this.gameId).emit('rematchCancelled'); // Уведомляем клиентов, что реванш отменен
                this.cleanup();
            }
        }, 60000); // 60 секунд
    }

    /**
     * "Чистит" игру: отписывается от событий и вызывает колбэк onGameEnd.
     */
    cleanup() {
        // Убираем слушатели, чтобы избежать утечек памяти и дублирования событий
        this.players.white.socket.removeAllListeners('makeMove');
        this.players.white.socket.removeAllListeners('resign');
        this.players.white.socket.removeAllListeners('requestRematch');

        this.players.black.socket.removeAllListeners('makeMove');
        this.players.black.socket.removeAllListeners('resign');
        this.players.black.socket.removeAllListeners('requestRematch');

        if (this.onGameEnd) {
            this.onGameEnd(this.gameId);
        }
    }

    // --- Вспомогательные функции ---

    getPlayerColor(socketId) {
        if (this.players.white.socket.id === socketId) return 'white';
        if (this.players.black.socket.id === socketId) return 'black';
        return null;
    }

    emitGameState() {
        this.io.to(this.gameId).emit('updateState', { fen: this.chess.fen() });
    }
}
