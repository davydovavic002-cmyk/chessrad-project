// public/js/lobby.js

document.addEventListener('DOMContentLoaded', async () => {
    // Находим все нужные элементы на странице
    const userStatusDiv = document.getElementById('user-status');
    const findGameBtn = document.getElementById('find-game-btn');
    const profileBtn = document.getElementById('profile-btn');
    // Добавляем поиск кнопки "Турниры"
    const tournamentsBtn = document.getElementById('tournaments-btn');
    const lobbyContainer = document.querySelector('.lobby-container');

    // --- 1. Главная логика: Проверка сессии и настройка ---
    try {
        // Запрашиваем данные по правильному адресу /api/session
        const response = await fetch('/api/session');

        // Если сессия АКТИВНА (ответ сервера "200 OK")
        if (response.ok) {
            const user = await response.json();
            // Вызываем функцию, которая настроит интерфейс
            setupLobbyUI(user);
        } else {
            // Если сессии НЕТ (ответ 401 или другой), перенаправляем на вход
            console.log('Сессия не найдена. Перенаправление на страницу входа.');
            window.location.href = '/'; // На главную
        }

    } catch (error) {
        // Если ошибка сети (сервер упал), тоже перенаправляем
        console.error('Сетевая ошибка при проверке сессии:', error);
        window.location.href = '/';
    }

    // --- 2. Функция настройки интерфейса (вызывается только при успехе) ---
    function setupLobbyUI(user) {
        if (!userStatusDiv || !profileBtn || !tournamentsBtn) return;

        // 2.1 Заполняем блок статуса пользователя
        userStatusDiv.innerHTML = `
            <span>Привет, <strong>${user.username}</strong>!</span>
            <button id="logout-btn" style="margin-left: 15px;">Выйти</button>
        `;

        // 2.2 Активируем кнопку "Мой профиль"
        profileBtn.disabled = false;
        profileBtn.addEventListener('click', () => {
            window.location.href = '/profile.html';
        });

        // 2.3 Обработчик для кнопки "Найти игру"
        findGameBtn.addEventListener('click', () => {
            window.location.href = '/game.html';
        });

        // =========================================================
        // ИЗМЕНЕНИЕ: Активируем кнопку "Турниры"
        // =========================================================
        tournamentsBtn.disabled = false;
        tournamentsBtn.addEventListener('click', () => {
            // Переходим на страницу со списком турниров
            window.location.href = '/tournaments.html';
        });

        // 2.4 Находим кнопку выхода (созданную в innerHTML) и вешаем обработчик
        document.getElementById('logout-btn').addEventListener('click', async () => {
            try {
                await fetch('/api/logout', { method: 'POST' });
                window.location.href = '/'; // На главную после выхода
            } catch (error) {
                console.error('Ошибка при выходе:', error);
            }
        });

        console.log('Лобби успешно настроено для пользователя:', user.username);
    }
});
