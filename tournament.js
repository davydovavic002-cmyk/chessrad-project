
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('jwtToken');

    // 1. Проверяем, есть ли токен ВООБЩЕ, ДО попытки подключения
    if (!token) {
        console.log('Токен не найден. Перенаправление на страницу входа.');
        window.location.href = '/'; // или /login.html
        return; // Прекращаем выполнение скрипта
    }

    // 2. Инициализируем сокет, ПЕРЕДАВАЯ ему токен
    const socket = io({
        auth: {
            token: token
        }
    });

    // 3. Обрабатываем ошибку, если сервер посчитал токен невалидным
    socket.on('connect_error', (err) => {
        if (err.message === "Unauthorized") {
            console.error("Сервер отклонил токен. Перенаправление на страницу входа.");
            localStorage.removeItem('jwtToken'); // Удаляем плохой токен
            window.location.href = '/'; // или /login.html
        }
    });

    // 4. Если все хорошо, начинаем слушать события турнира
    socket.on('connect', () => {
        console.log('Успешно подключено к серверу турнира!');
    });

    socket.on('tournament:stateUpdate', (state) => {
        updateTournamentUI(state);
    });


function setupTournamentPage(user, token) {
    const userStatusDiv = document.getElementById('user-status');
    if (userStatusDiv) {
        userStatusDiv.innerHTML = `Вы вошли как: <strong>${user.username}</strong> | <a href="#" id="logout-btn">Выйти</a>`;
        document.getElementById('logout-btn').addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('jwtToken');
            if (socket) socket.disconnect();
            window.location.href = '/index.html';
        });
    }

    const socket = io({ auth: { token } });

    // --- ПОЛУЧАЕМ ССЫЛКИ НА ВСЕ ЭЛЕМЕНТЫ СО СТРАНИЦЫ (ID из HTML) ---
    const registerBtn = document.getElementById('registerBtn');
    const tournamentStatusEl = document.getElementById('tournament-status');
    const playerCountEl = document.getElementById('player-count');
    const playerListEl = document.getElementById('playerlist');
    const roundNumberEl = document.getElementById('round-number');
    const pairingsTableBody = document.querySelector('#pairingstable tbody');
    const standingsTableBody = document.querySelector('#standingstable tbody');

    // Для теста добавим кнопку "Старт" (можно убрать в будущем)
    const startBtn = document.createElement('button');
    startBtn.textContent = 'Начать турнир (тест)';
    startBtn.style.marginLeft = '10px';
    registerBtn.after(startBtn);

    // --- НАЗНАЧАЕМ ДЕЙСТВИЯ ---
    registerBtn.addEventListener('click', () => socket.emit('tournament:register'));
    startBtn.addEventListener('click', () => socket.emit('tournament:start'));

    // --- ГЛАВНЫЙ ОБРАБОТЧИК СОБЫТИЙ ОТ СЕРВЕРА ---
    socket.on('tournament:stateUpdate', (state) => {
        console.log('Получено обновление состояния:', state);

        tournamentStatusEl.textContent = getTournamentStatusText(state.status);
        roundNumberEl.textContent = state.currentRound || 0;
        playerCountEl.textContent = `(${state.players.length})`;

        playerListEl.innerHTML = '';
        state.players.forEach(player => {
            playerListEl.innerHTML += `<li>${player.username}</li>`;
        });

        const isRegistered = state.players.some(p => p.id === user.id);
        registerBtn.disabled = isRegistered || state.status !== 'waiting';
        registerBtn.textContent = isRegistered ? 'Вы зарегистрированы' : 'Зарегистрироваться на турнир';

        pairingsTableBody.innerHTML = '';
        if (!state.pairings || state.pairings.length === 0) {
            pairingsTableBody.innerHTML = '<tr><td colspan="3">Пары еще не сформированы.</td></tr>';
        } else {
            state.pairings.forEach(match => {
                const p1 = match.player1 ? match.player1.username : 'Ожидание';
                const p2 = match.player2 ? match.player2.username : 'BYE (пропуск)';
                const result = match.result || 'не сыграно';
                pairingsTableBody.innerHTML += `<tr><td>${p1}</td><td>${p2}</td><td>${result}</td></tr>`;
            });
        }

        standingsTableBody.innerHTML = '';
        if (!state.standings || state.standings.length === 0) {
            standingsTableBody.innerHTML = '<tr><td colspan="6">Таблица пуста.</td></tr>';
        } else {
            // Сервер уже отсортировал, просто выводим
            state.standings.forEach((player, index) => {
                standingsTableBody.innerHTML += `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${player.username}</td>
                        <td>${player.score}</td>
                        <td>${player.wins || 0}</td>
                        <td>${player.draws || 0}</td>
                        <td>${player.losses || 0}</td>
                    </tr>
                `;
            });
        }
    });

    socket.on('tournament:error', (errorMessage) => alert(`Ошибка турнира: ${errorMessage}`));
    socket.on('connect', () => socket.emit('tournament:getState'));
    socket.on('connect_error', (err) => {
        if (err.message === 'Authentication error') {
            alert('Ошибка аутентификации. Пожалуйста, войдите снова.');
            localStorage.removeItem('jwtToken');
            window.location.href = '/login.html';
        }
    });
}

function getTournamentStatusText(status) {
    const statuses = { 'waiting': 'Ожидание регистрации', 'playing': 'Идет игра', 'finished': 'Завершен' };
    return statuses[status] || 'Неизвестно';
}
