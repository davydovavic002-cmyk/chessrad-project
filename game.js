$(document).ready(function() {
    // ==========================================================
    // 1. ИНИЦИАЛИЗАЦИЯ
    // ==========================================================

    let board = null;
    const game = new Chess();
    let myColor = 'white';
    let gameRoomId = null;

    // Кэширование jQuery-объектов для производительности
    const $status = $('#status');
    const $fen = $('#fen');
    const $pgn = $('#pgn');
    const $turnInfo = $('#turn-info');
    const $gameControls = $('#game-controls');
    const $findGameBtn = $('#find-game-btn');
    const $resignBtn = $('#resign-btn');
    const $rematchBtn = $('#rematch-btn');

    // ==========================================================
    // 2. ПОДКЛЮЧЕНИЕ SOCKET.IO
    // ==========================================================

    const socket = io();

    // ==========================================================
    // 3. ЛОГИКА ДОСКИ CHESSBOARD.JS
    // ==========================================================

    // Запрещает ход, если: игра окончена, не наш ход или двигаем фигуру противника
    function onDragStart(source, piece) {
        // ИСПРАВЛЕНАЯ ЛОГИКА ПРОВЕРКИ
        if (game.game_over() ||
            // Проверка, чей сейчас ход
            ((game.turn() === 'w' && myColor !== 'white') || (game.turn() === 'b' && myColor !== 'black')) ||
            // Проверка, что игрок двигает свою фигуру
            ((myColor === 'white' && piece.search(/^b/) !== -1) || (myColor === 'black' && piece.search(/^w/) !== -1))) {
            return false;
        }
    }

    // Отправляет попытку хода на сервер
    function onDrop(source, target) {
        const moveAttempt = {
            from: source,
            to: target,
            promotion: 'q' // Всегда предлагаем превращение в ферзя для простоты
        };
        socket.emit('move', { move: moveAttempt, roomId: gameRoomId });
    }

    // Эта функция нужна, чтобы chessboard.js не возвращал фигуру на место
    // после нашего хода. Мы ждем ответа от сервера.
    function onSnapEnd() {}

    // ==========================================================
    // 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ИНТЕРФЕЙСА
    // ==========================================================

    function updateStatus(message) {
        $status.html(message);
    }

    function updatePgnAndFen() {
        $fen.text(game.fen());
        $pgn.text(game.pgn());
    }

    function updateTurnInfo() {
        if (game.game_over()) {
            $turnInfo.text('Игра окончена').removeClass('my-turn');
            return;
        }

        const isMyTurn = (myColor === 'white' && game.turn() === 'w') || (myColor === 'black' && game.turn() === 'b');
        let text = isMyTurn ? 'Ваш ход' : 'Ход соперника';

        if (game.in_check()) {
            text += ' (Шах!)';
        }

        $turnInfo.text(text).toggleClass('my-turn', isMyTurn);
    }

    // ==========================================================
    // 5. ОБРАБОТЧИКИ СОБЫТИЙ SOCKET.IO
    // ==========================================================

    socket.on('connect', () => {
        console.log('Успешно подключено. Socket ID:', socket.id);
        updateStatus('Подключено. Нажмите "Найти игру"');
        $findGameBtn.prop('disabled', false).show();
    });

    socket.on('disconnect', () => {
        console.error('Отключено от сервера');
        updateStatus('Потеряно соединение. Пожалуйста, обновите страницу.');
        $findGameBtn.prop('disabled', true);
        $resignBtn.prop('disabled', true);
    });

    socket.on('status', (message) => {
        console.log('Статус от сервера:', message);
        updateStatus(message);
    });

    socket.on('gameStart', (data) => {
        console.log('Игра начинается:', data);
        myColor = data.color;
        gameRoomId = data.roomId;
        const opponentUsername = data.opponent.username || 'Соперник';

        game.reset();
        if (data.fen) game.load(data.fen);

        const boardConfig = {
            draggable: true,
            position: game.fen(),
            orientation: myColor,
            onDragStart: onDragStart,
            onDrop: onDrop,
            onSnapEnd: onSnapEnd
        };

        if (!board) {
            board = Chessboard('myBoard', boardConfig); // Эта строка рисует доску в первый раз
        } else {
            board.orientation(myColor);
            board.position(game.fen());
        }

        $findGameBtn.hide();
        $gameControls.show();
        $rematchBtn.hide();
        $resignBtn.show().prop('disabled', false);

        const colorText = myColor === 'white' ? 'белыми' : 'черными';
        updateStatus(`Игра против <b>${opponentUsername}</b>. Вы играете ${colorText}.`);
        updatePgnAndFen();
        updateTurnInfo();
    });

    socket.on('updateState', (data) => {
        console.log('Получено обновление состояния:', data);
        if (data.fen) {
            game.load(data.fen);
            board.position(data.fen);
            updatePgnAndFen();
            updateTurnInfo();
        }
    });

    socket.on('gameOver', (data) => {
        console.log('Игра окончена:', data);
        let statusMessage = 'Игра окончена.';
        switch (data.type) {
            case 'checkmate':
                statusMessage = `Мат! Победил(а) <b>${data.winner}</b>.`;
                break;
            case 'resign':
                statusMessage = `<b>${data.loser}</b> сдался. Победил(а) <b>${data.winner}</b>.`;
                break;
            case 'draw':
                statusMessage = 'Ничья.';
                break;
            case 'stalemate':
                statusMessage = 'Ничья (пат).';
                break;
        }

        updateStatus(statusMessage);
        $resignBtn.prop('disabled', true);

        // ОБНОВЛЕННАЯ ЛОГИКА: Показываем кнопку и сбрасываем ее в начальное состояние
        $rematchBtn.show().text('Реванш').prop('disabled', false).removeClass('glowing-button');

        updateTurnInfo();
    });

    // ==========================================================
    // НОВЫЕ СЛУШАТЕЛИ ДЛЯ РЕВАНША
    // ==========================================================

    // Сервер сообщает, что соперник предложил реванш
    socket.on('rematchOffered', () => {
        updateStatus('Соперник предлагает реванш!');
        $rematchBtn.text('Принять реванш?').prop('disabled', false).addClass('glowing-button');
    });

    // Сервер сообщает, что предложение о реванше отменено (например, соперник ушел)
    socket.on('rematchCancelled', () => {
        updateStatus('Предложение о реванше отменено.');
        $rematchBtn.text('Реванш').prop('disabled', false).removeClass('glowing-button');
    });

    // ==========================================================
    // 6. ОБРАБОТЧИКИ НАЖАТИЙ НА КНОПКИ
    // ==========================================================

    $findGameBtn.on('click', function() {
        $(this).prop('disabled', true).text('Поиск игры...');
        socket.emit('findGame');
    });

    $resignBtn.on('click', function() {
        if (confirm('Вы уверены, что хотите сдаться?')) {
            socket.emit('resign', { roomId: gameRoomId });
        }
    });

    $rematchBtn.on('click', function() {
        // Эта логика универсальна: и для предложения, и для принятия реванша
        $(this).prop('disabled', true).text('Ожидание ответа...').addClass('glowing-button');
        socket.emit('requestRematch', { roomId: gameRoomId });
    });

}); // Конец $(document).ready
