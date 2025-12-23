// public/js/profile.js

document.addEventListener('DOMContentLoaded', () => {
    // Находим все элементы на странице
    const profileInfoDiv = document.getElementById('profile-info');
    const skillLevelSelect = document.getElementById('skill-level-select');
    const saveSkillBtn = document.getElementById('save-skill-btn');
    const skillSaveStatus = document.getElementById('skill-save-status');
    const logoutLink = document.getElementById('logout-link-profile');

    // Функция загрузки данных пользователя
    const loadUserProfile = async () => {
        try {
            const response = await fetch('/api/session');

            if (response.ok) {
                const user = await response.json();

                // ИЗМЕНЕНО: Отображаем данные без email
                profileInfoDiv.innerHTML = `
                    <p><strong>Имя пользователя:</strong> ${user.username}</p>
                    <p><strong>Рейтинг:</strong> ${user.rating || 1200}</p>
                `;

                // Устанавливаем текущий уровень, если он есть
                if (user.level) {
                    skillLevelSelect.value = user.level;
                }

            } else {
                window.location.href = '/';
            }
        } catch (error) {
            console.error('Ошибка загрузки профиля:', error);
            profileInfoDiv.innerHTML = '<p style="color: red;">Не удалось загрузить данные профиля.</p>';
        }
    };

    // ИЗМЕНЕНО: Теперь это полнофункциональный обработчик сохранения
    saveSkillBtn.addEventListener('click', async () => {
        const newSkillLevel = skillLevelSelect.value;
        skillSaveStatus.textContent = 'Сохранение...';
        skillSaveStatus.style.color = 'inherit'; // Сброс цвета

        try {
            const response = await fetch('/api/user/level', { // Отправляем запрос на наш новый обработчик
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ level: newSkillLevel }),
            });

            if (!response.ok) {
                // Если сервер вернул ошибку, выводим ее
                throw new Error('Сервер вернул ошибку при сохранении');
            }

            skillSaveStatus.style.color = 'green';
            skillSaveStatus.textContent = 'Сохранено!';

        } catch (error) {
            console.error('Ошибка сохранения уровня:', error);
            skillSaveStatus.style.color = 'red';
            skillSaveStatus.textContent = 'Ошибка!';
        } finally {
            // Убираем сообщение через 3 секунды в любом случае
            setTimeout(() => {
                skillSaveStatus.textContent = '';
            }, 3000);
        }
    });

    // Обработчик выхода
    logoutLink.addEventListener('click', async (event) => {
        event.preventDefault();
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
    });

    // Запускаем загрузку профиля
    loadUserProfile();
});
