// ИСПРАВЛЕНО: 'kdocument' заменено на 'document'
document.addEventListener('DOMContentLoaded', () => {

    // --- Находим все нужные элементы на странице ---
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');
    const showRegisterLink = document.getElementById('show-register');
    const showLoginLink = document.getElementById('show-login');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const errorMessage = document.getElementById('error-message');
    const authContainer = document.querySelector('.auth-container');

    // Если мы не на странице авторизации (например, в лобби), ничего не делаем
    if (!authContainer) return;

    // --- Функция для удобного отображения ошибок ---
    function displayError(message) {
        if (errorMessage) {
            errorMessage.textContent = message;
            errorMessage.classList.remove('hidden');
        } else {
            console.error('Не найден элемент для вывода ошибки, но произошла ошибка:', message);
        }
    }

    // --- Функция начальной проверки авторизации ---
    async function checkAuthAndInitialize() {
        try {
            const response = await fetch('/api/session', {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            // Если сессия есть, перенаправляем в лобби
            if (response.ok) {
                console.log('Сессия активна. Перенаправление в lobby.html');
                window.location.href = '/lobby.html';
                return; // Прерываем выполнение, чтобы не показывать форму
            }

        } catch (error) {
            console.error('Ошибка сети при проверке сессии:', error);
            displayError('Не удалось проверить сессию. Проверьте подключение к сети.');
        }

        // Показываем контейнер с формами, только если сессия неактивна
        authContainer.style.visibility = 'visible';
    }

    // --- Переключатели между формами входа и регистрации ---
    if (showRegisterLink) {
        showRegisterLink.addEventListener('click', (e) => {
            e.preventDefault();
            loginView.classList.add('hidden');
            registerView.classList.remove('hidden');
            if (errorMessage) errorMessage.classList.add('hidden'); // Скрываем старые ошибки
        });
    }

    if (showLoginLink) {
        showLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            registerView.classList.add('hidden');
            loginView.classList.remove('hidden');
            if (errorMessage) errorMessage.classList.add('hidden'); // Скрываем старые ошибки
        });
    }

    // --- Обработка формы ВХОДА ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (errorMessage) errorMessage.classList.add('hidden');

            const formData = new FormData(loginForm);
            const data = Object.fromEntries(formData.entries());

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    console.log('Вход успешен. Перенаправление...');
                    window.location.href = '/lobby.html';
                } else {
                    const errorData = await response.json();
                    displayError(errorData.message || 'Произошла ошибка входа');
                }
            } catch (error) {
                console.error('Ошибка сети при входе:', error);
                displayError('Ошибка сети. Попробуйте снова.');
            }
        });
    }

    // --- Обработка формы РЕГИСТРАЦИИ ---
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (errorMessage) errorMessage.classList.add('hidden');

            const formData = new FormData(registerForm);
            const data = Object.fromEntries(formData.entries());

            if (data.password !== data.confirmPassword) {
                displayError('Пароли не совпадают');
                return;
            }

            try {
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: data.username, password: data.password })
                });

                if (response.ok) {
                    alert('Регистрация успешна! Теперь вы можете войти.');
                    registerView.classList.add('hidden');
                    loginView.classList.remove('hidden');
                } else {
                    const errorData = await response.json();
                    displayError(errorData.message || 'Произошла ошибка регистрации');
                }
            } catch (error) {
                console.error('Ошибка сети при регистрации:', error);
                displayError('Ошибка сети. Попробуйте снова.');
            }
        });
    }

    // --- Запускаем проверку авторизации при загрузке страницы ---
    checkAuthAndInitialize();
});
