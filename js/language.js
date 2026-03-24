// js/language.js

// Объект с переводами для всех страниц
const translations = {
    'ru': {
        // Общие элементы
        'nav_home': '← Главная',
        'nav_language': '🌐 Eng',
        'nav_theme': '🌙 Тема',
        'nav_mode': 'Сменить режим',
        'nav_serious': 'Серьёзный режим',
        'nav_standard': 'Стандартный режим',
        'nav_evil': 'Злой старшекурсник',
        
        // Главная страница
        'main_title': 'GradeMaster - Главная страница',
        'main_description': 'Выберите тип калькулятора',
        'welcome': 'Добро пожаловать в GradeMaster!',
        'description': 'Набор инструментов для студентов',
        'option_total_title': '🚀 Калькулятор Итоговой Оценки',
        'option_total_desc': 'Калькулятор помогающий понять как сильно надо готовиться',
        'option_gpa_title': '📊 Калькулятор Итогового GPA',
        'option_gpa_desc': 'Калькулятор помогающий понять сколько вы получили',
        'option_att_title': '📋 Калькулятор Посещаемости',
        'option_att_desc': 'Отслеживание и расчет посещаемости',
        'option_converter_title': '🔄 Конвертер оценок в GPA',
        'option_converter_desc': 'Перевод процентной оценки в GPA',
        'option_feedback_title': '💬 Обратная связь',
        'option_feedback_desc': 'Помогите улучшить приложение',
        'feature_transparency': '• Максимальная прозрачность',
        'feature_manual': '• Ручной ввод всех параметров',
        'feature_all_subjects': '• Подходит для любых предметов',
        'go_button': 'Перейти',
        'nav_feedback': '💬 Обратная связь',
        'option_templates_title': '📚 Предметные шаблоны',
        'option_templates_desc': 'Готовые настройки для популярных направлений',
        'feature_fast_start': '• Быстрый старт',
        'feature_popular_subjects': '• Популярные предметы',
        'feature_preset_weights': '• Предустановленные веса',
        'option_attendance_title': '📚 Калькулятор посещаемости',
        'option_attendance_desc': 'Удобный калькулятор для подсчета своей посещаемости',
        'feature_readable_interface': '• Читаемый интерфейс',
        'feature_clear_method': '• Понятный метод подсчета',
        'gpa_button': 'Калькулятор GPA',
        'converter_button': 'Конвертер оценок',
        'support_button': 'Поддержать автора',
        
        // Калькулятор оценок
        'calculator_title': '📚 Калькулятор оценок',
        'page_title_total': 'GradeMaster - Калькулятор оценок',
        'page_title_gpa': 'GPA Calculator - GradeMaster',
        'page_title_attendance': 'Attendance Calculator - GradeMaster',
        'page_title_feedback': 'GradeMaster - Feedback',
        'page_title_template': 'Grade Calculator - Structured',
        'current_mode': 'Текущий режим:',
        'regmid_label': 'РегМид (0-100)',
        'regmid_placeholder': 'Введите оценку',
        'regend_label': 'РегЭнд (0-100)',
        'regend_placeholder': 'Введите оценку',
        'regterm_label': 'РегТерм (0-100)',
        'regterm_placeholder': 'Или введите РегТерм напрямую',
        'final_label': 'Файнал (0-100)',
        'final_placeholder': 'Оставьте пустым для прогноза',
        'calculate_btn': 'Рассчитать',
        'warning_text': '⚠️ Важно: Списывание ведёт к отчислению!',
        'share_button': '🔗 Создать ссылку для друга',
        'share_link_label': 'Ссылка для общего доступа:',
        'copy_button': 'Копировать',
        'share_info': 'Эта ссылка будет активна 24 часа и сохранит все введённые данные',
        
        // GPA калькулятор
        'gpa_title': '📊 GPA Calculator',
        'gpa_description': 'Расчет средневзвешенного GPA с учетом кредитов',
        'gpa_formula': 'GPA = Σ(GPA<sub>предмета</sub> × кредиты) / Σ(кредиты)',
        'subjects_count': 'Количество предметов:',
        'generate_subjects': 'Сгенерировать форму для предметов',
        'gpa_warning': '⚠️ Важно: Введите корректные данные для всех предметов!',
        
        // Конвертер оценок
        'converter_title': '🔄 Конвертер оценок в GPA',
        'converter_description': 'Перевод процентной оценки в GPA',
        'percentage_label': 'Итоговая оценка в процентах (%):',
        'percentage_placeholder': 'Например: 85',
        'convert_btn': 'Конвертировать в GPA',
        
        // Страница поддержки
        'support_title': '🤝 Поддержка проекта',
        'support_description': '❤️ GradeMaster — бесплатный некоммерческий проект для студентов',
        'kaspi_title': '🇰🇿 Kaspi перевод',
        'kaspi_card': 'Номер карты:',
        'yoomoney_title': '💰 ЮMoney (Яндекс.Деньги)',
        'yoomoney_wallet': 'Кошелек:',
        'bank_title': '💳 Банковский перевод',
        'bank_details': 'Реквизиты:',
        'copy_btn': 'Копировать',
        'quick_transfer': '📱 Быстрый перевод через Kaspi',
        'qr_description': 'Отсканируйте QR-код для открытия приложения Kaspi с заполненными реквизитами:',
        'select_amount': 'Выберите сумму (₸):',
        'custom_amount': 'Другая сумма',
        'generate_qr': '✨ Создать QR-код',
        'important_info': 'ℹ️ Важная информация:',
        'support_warning': 'Это добровольная поддержка некоммерческого проекта. Все калькуляторы остаются полностью бесплатными.',
        'thank_you': '🙏 Спасибо за вашу поддержку!',
        
        // Footer
        'footer_copyright': '&copy; 2025 Not_404. In case of any bug contact via Telegram',
        
        // Результаты калькулятора
        'error_empty': '❌ Пожалуйста, введите все значения для расчёта.',
        'error_invalid': '❌ Ошибка: Все оценки должны быть в диапазоне от 0 до 100',
        'success_scholarship': '✅ Успех! Обычная стипендия!',
        'success_high_scholarship': '💎 Превосходно! Повышенная стипендия!',
        'warning_pass': '⚠️ Без стипендии',
        'danger_fail': '❌ Летник',
        
        // Названия режимов и сообщения
        'mode_serious': 'Серьёзный режим',
        'mode_standard': 'Стандартный режим',
        'mode_evil': 'Злой старшекурсник',
        'mode_serious_msg': 'Режим серьёзного аналитика.',
        'mode_standard_msg': 'Стандартный режим. Всё по делу.',
        'mode_evil_msg': 'Режим злого старшекурсника.',
        
        // Сообщения серьёзного режима
        'empty_msg_1': 'Пожалуйста, введите все значения для расчёта.',
        'empty_msg_2': 'Все поля должны быть заполнены для точного результата.',
        'invalid_msg_1': 'Введите корректные значения от 0 до 100.',
        'invalid_msg_2': 'Некорректные данные, проверяйте диапазон оценок.',
        'pass_msg_1': 'Вы прошли курс. Итоговая оценка в пределах нормы.',
        'pass_msg_2': 'Курс сдан успешно, поздравляем!',
        'prediction_msg_1': 'Расчёт необходимых баллов:',
        'prediction_msg_2': 'Сколько нужно набрать на файнале:',
        
        // Сообщения стандартного режима
        'standard_empty_1': 'Заполните все поля для расчёта.',
        'standard_empty_2': 'Не забудьте ввести все оценки.',
        'standard_invalid_1': 'Оценки должны быть от 0 до 100.',
        'standard_invalid_2': 'Некорректное значение, проверяйте диапазон.',
        'standard_pass_1': 'Вы прошли курс. Итоговая оценка в пределах нормы.',
        'standard_pass_2': 'Курс сдан успешно, поздравляем!',
        'standard_fail_1': 'К сожалению, результат ниже проходного балла.',
        'standard_fail_2': 'Летник неизбежен, пора пересдавать.',
        'standard_scholarship_1': 'Поздравляем! Вы получаете стипендию.',
        'standard_scholarship_2': 'Стипендия у ваших ног, молодец!',
        'standard_high_scholarship_1': 'Превосходно! Вы получаете повышенную стипендию!',
        'standard_high_scholarship_2': 'Высший результат! Повышенная стипендия гарантирована!',
        'standard_high_1': 'Отличный результат! Вы показали высокий уровень знаний.',
        'standard_high_2': 'Превосходно! Так держать.',
        'already_failed_1': 'По текущим результатам сдать курс невозможно.',
        'already_failed_2': 'Даже идеальный файнал не спасёт ситуацию.',
        
        // Сообщения режима злого старшекурсника
        'evil_empty_1': 'Ты серьёзно забыл ввести числа? Или это тоже нужно объяснять?',
        'evil_empty_2': 'Ничего не введено. Серьёзно?',
        'evil_invalid_1': 'Оценки от 0 до 100, а не от минус бесконечности до 200. Математику учили?',
        'evil_invalid_2': 'Некорректные данные. Ты точно на этом курсе?',
        'evil_pass_1': 'Выжил. Едва, но выжил. Поздравляю с минимальным результатом.',
        'evil_pass_2': 'Ну, ты сдал. Почти чудо.',
        'evil_fail_1': 'Летник. Не плачь, я просто посчитал. Встретимся на пересдаче!',
        'evil_fail_2': 'Ты провалился. На счастье это было предсказуемо.',
        'evil_scholarship_1': 'Со стипендией! Не растрать её на кофе в первый же день.',
        'evil_scholarship_2': 'Поздравляю, стипендия твоя!',
        'evil_high_scholarship_1': 'Серьёзно? Повышенная стипендия? Ты точно не списывал?',
        'evil_high_scholarship_2': 'Не ожидал такого от тебя!',
        'evil_high_1': 'Потрясающий результат! Оказывается, ты тоже можешь что-то.',
        'evil_high_2': 'Ну, впечатлён! Продолжай так.',
        'evil_already_failed_1': 'По текущим результатам дела обстоят плохо.',
        'evil_already_failed_2': 'Даже 100 на файнале не спасёт. Летник неизбежен.',
        'impossible_scholarship': 'Нужно больше 100 баллов. Может, попробуешь взятку? Шучу... или нет 🤔',
        
        // Калькулятор посещаемости
        'att_error': 'Ошибка',
        'att_please_enter': 'Пожалуйста, введите количество пар в неделю.',
        'att_range_error': 'Количество пар должно быть от 1 до 50.',
        
        // Сообщения GPA калькулятора
        'gpa_correct_count': 'Пожалуйста, введите корректное количество предметов (1-20)',
        'gpa_fill_all': 'Пожалуйста, проверьте введенные данные. Все поля должны быть заполнены корректно.',
        'gpa_insufficient': 'Недостаточно данных для расчета. Добавьте хотя бы один предмет с кредитами и оценкой.',
        'gpa_overall': 'Общий GPA (средневзвешенный):',
        
        // Сообщения шаблонного калькулятора
        'template_excellent': 'Отлично!',
        'template_excellent_comment': 'Превосходный результат!',
        'template_good': 'Хорошо',
        'template_good_comment': 'Курс успешно сдан!',
        'template_satisfactory': 'Удовлетворительно',
        'template_satisfactory_comment': 'Курс сдан, но есть куда расти',
        'template_unsatisfactory': 'Неудовлетворительно',
        'template_unsatisfactory_comment': 'Необходима пересдача',
        'template_overall_result': 'Общий результат:',
        
        // Сообщения калькулятора среднего GPA за триместры
        'cumulative_title': '📈 Калькулятор среднего GPA',
        'cumulative_desc': 'Введите GPA и кредиты для каждого триместра',
        'terms_count': 'Количество триместров:',
        'generate_terms': 'Сгенерировать поля',
        'calculate_btn': 'Рассчитать средний GPA',
        'cumulative_results': '📋 Результаты расчета',
        'cumulative_term': 'Триместр',
        'cumulative_gpa': 'GPA',
        'cumulative_credits': 'Кредиты',
        'cumulative_weighted': 'GPA × Кредиты',
        'cumulative_total': 'Общий GPA (средневзвешенный):',
        'sigma_gpa_credits': 'Σ(GPA × кредиты)',
        'sigma_credits': 'Σ(кредиты)',
        'term_gpa_placeholder': 'GPA триместра',
        'term_credits_placeholder': 'Кредиты',
        
        // Сообщения обратной связи
        'feedback_type_suggestion': 'Предложение',
        'feedback_type_bug': 'Багрепорт',
        'feedback_type_feature': 'Запрос функции',
        'feedback_type_other': 'Обращение',
        'feedback_sending': 'Отправка...',
        'feedback_error': 'Ошибка отправки сообщения',
        'feedback_success': 'Спасибо за вашу обратную связь!',
        'feedback_success_contact': 'Мы скоро свяжемся с вами!',
        
        // Дополнительные строки из total.js
        'regmid_below_25': 'РегМид < 25? Серьёзно? Вы вообще на пары ходили? 💀',
        'regmid_below_minimum': 'РегМид ниже минимального порога. Курс не может быть сдан.',
        'regmid_below_25_standard': 'РегМид меньше 25. Летник без вариантов.',
        'regend_below_25_evil': 'РегЭнд < 25... Кажется, кто-то пропустил пару важных лекций. Или все.',
        'regend_below_25_serious': 'РегЭнд ниже минимального порога. Курс не может быть сдан.',
        'regend_below_25_standard': 'РегЭнд меньше 25. Летник без вариантов.',
        'regterm_direct_input': ' (введён напрямую)',
        'regterm_below_50': 'РегТерм < 50. Поздравляю, ты даже до файнала не добрался а уже летка!',
        'regterm_below_50_serious': 'РегТерм ниже минимального порога. Курс не может быть сдан.',
        'regterm_below_50_standard': 'РегТерм меньше 50. Летник неизбежен.',
        'retake_evil': 'Файнал между 25 и 50. Судьба дала второй шанс, не облажайся.',
        'retake_serious': 'Экзамен не сдан, но предоставляется возможность пересдачи.',
        'retake_standard': 'Пересдача. У вас есть второй шанс.',
        'prediction_title': '🔮 Прогноз',
        'regterm_display': 'РегТерм: {value}{source}',
        'critical_check': 'Проверка критических условий',
        'impossible_pass': 'Невозможно (нужно {value} > 100)',
        'for_regular_scholarship': 'Для обычной стипендии:',
        'minimum_points': 'Минимум {value} баллов',
        'for_high_scholarship': 'Для повышенной стипендии:',
        'higher_scholarship': 'Повышенная стипендия неозможна',
        'impossible_scholarship_evil': 'Нужно больше 100 баллов. Может, попробуешь взятку? Шучу... или нет 🤔',
        'impossible_scholarship_standard': 'Невозможно получить стипендию при текущих результатах.',
        'impossible_scholarship_serious': 'Невозможно получить стипендию при текущих результатах.',
        'failed_title': '❌ Летник',
        'retake_title': '⚠️ Пересдача',
        'pass_title': '⚠️ Без стипендии',
        'scholarship_title': '✅ Успех! Обычная стипендия!',
        'high_scholarship_title': '💎 Превосходно! Повышенная стипендия!',
        'details_calculation': 'Детали расчёта: РегТерм = {regterm}, Итоговый балл = {total}',
        'details_calculation_evil': 'Детали: РегТерм = {regterm}, Итоговый = {total}',
        'invalid_link': '❌ Ссылка недействительна или устарела',
        'expired_link': '❌ Срок действия ссылки истёк',
        
        // Секретные сообщения из template.js и total.js
        'secret_manual_check': 'Секретный совет: всегда проверяйте расчеты вручную!',
        'secret_rare_user': 'Ты - 1 из 1000 пользователей, который нашел эту пасхалку!',
        'secret_easter_egg': 'Мои поздравления пасхантер, может и на других страницах что то есть?)',
        'secret_auto_passing': 'Функция \'автоматического прохождения экзамена\' еще в разработке...',
        'secret_calculator_student': 'Знаете, почему калькулятор такой точный? Он не списывал на экзаменах!',
        'secret_calculator_scholarship': 'Если бы этот калькулятор был студентом, у него была бы стипендия!',
        'secret_leak': 'Внимание! Обнаружена утечка: файнал составляет 40% от оценки!',
        'secret_hack': 'Хакерский совет: чтобы сдать экзамен, нужно на него прийти 😉',
        'secret_success': 'Секрет успеха: 10% везение, 20% навыки, 70% этот калькулятор!',
        'secret_warning': 'Предупреждение: чрезмерное использование калькулятора может привести к... хорошим оценкам!',
        'secret_difference': 'Знаете разницу между студентом и этим калькулятором? Калькулятор всегда считает правильно!',
        'secret_excuse': 'Поздравляю! Вы нашли оправдание не готовиться к экзамену!',
        
        // Сообщения из att.js  
        'att_note': 'Примечание: Фактическое количество допустимых пропусков может зависеть от конкретного предмета, сверьтесь с силлабусом данного курса.',
        
        // Комментарии из режимов
        'evil_pass_comment_hard': ' (Ого! Это будет СЛОЖНО)',
        'evil_pass_comment_medium': ' (Готовься жить в библиотеке)',
        'evil_pass_comment_easy': ' (Вполне реально)',
        'serious_pass_comment': '',
        'standard_pass_comment_hard': ' (очень сложно)',
        'standard_pass_comment_medium': ' (нужна хорошая подготовка)',
        'standard_pass_comment_easy': ' (достижимо)',
        'evil_scholarship_comment_fantasy': ' (Это уже из области фантастики!)',
        'evil_scholarship_comment_hard': ' (На грани возможного!)',
        'evil_scholarship_comment_medium': ' (Потребуются невероятные усилия)',
        'serious_scholarship_comment_hard': ' (экстремально сложно)',
        'serious_scholarship_comment_medium': ' (очень высокая сложность)',
        'serious_scholarship_comment_easy': ' (высокая сложность)',
        'standard_scholarship_comment_hard': ' (очень высокая планка)',
        'standard_scholarship_comment_medium': ' (серьёзная подготовка)',
        'standard_scholarship_comment_easy': ' (хороший шанс)',
        'evil_high_scholarship_comment_fantasy': ' (Начинай молиться 🙏)',
        'evil_high_scholarship_comment_hard': ' (Выучи ВСЁ!)',
        'evil_high_scholarship_comment_easy': ' (Это реально!)'
        
    },
    
    'en': {
        // Common elements
        'nav_home': '← Home',
        'nav_language': '🌐Рус',
        'nav_theme': '🌙 Theme',
        'nav_mode': 'Change mode',
        'nav_serious': 'Serious mode',
        'nav_standard': 'Standard mode',
        'nav_evil': 'Evil upperclassman',
        
        // Main page
        'main_title': 'GradeMaster - Main Page',
        'main_description': 'Select calculator type',
        'welcome': 'Welcome to GradeMaster!',
        'description': 'A set of tools for students',
        'option_total_title': '🚀 Final Grade Calculator',
        'option_total_desc': 'Calculator to understand how hard you need to prepare',
        'option_gpa_title': '📊 GPA Calculator',
        'option_gpa_desc': 'Calculator to understand your grades',
        'option_att_title': '📋 Attendance Calculator',
        'option_att_desc': 'Track and calculate attendance',
        'option_converter_title': '🔄 Grade to GPA Converter',
        'option_converter_desc': 'Convert percentage grades to GPA',
        'option_feedback_title': '💬 Feedback',
        'option_feedback_desc': 'Help improve the app',
        'feature_transparency': '• Maximum transparency',
        'feature_manual': '• Manual entry of all parameters',
        'feature_all_subjects': '• Works for any subject',
        'go_button': 'Go',
        'nav_feedback': '💬 Feedback',
        'option_templates_title': '📚 Subject Templates',
        'option_templates_desc': 'Ready-made settings for popular specialties',
        'feature_fast_start': '• Quick start',
        'feature_popular_subjects': '• Popular subjects',
        'feature_preset_weights': '• Preset weights',
        'option_attendance_title': '📚 Attendance Calculator',
        'option_attendance_desc': 'Convenient calculator for tracking attendance',
        'feature_readable_interface': '• Readable interface',
        'feature_clear_method': '• Clear counting method',
        'gpa_button': 'GPA Calculator',
        'converter_button': 'Grade Converter',
        'support_button': 'Support the author',
        
        // Grade Calculator
        'calculator_title': '📚 Grade Calculator',
        'page_title_total': 'GradeMaster - Grade Calculator',
        'page_title_gpa': 'GPA Calculator - GradeMaster',
        'page_title_attendance': 'Attendance Calculator - GradeMaster',
        'page_title_feedback': 'GradeMaster - Feedback',
        'page_title_template': 'Grade Calculator - Structured',
        'current_mode': 'Current mode:',
        'regmid_label': 'RegMid (0-100)',
        'regmid_placeholder': 'Enter grade',
        'regend_label': 'RegEnd (0-100)',
        'regend_placeholder': 'Enter grade',
        'regterm_label': 'RegTerm (0-100)',
        'regterm_placeholder': 'Or enter RegTerm directly',
        'final_label': 'Final (0-100)',
        'final_placeholder': 'Leave empty for prediction',
        'calculate_btn': 'Calculate',
        'warning_text': '⚠️ Important: Cheating leads to expulsion!',
        'share_button': '🔗 Create link for a friend',
        'share_link_label': 'Share link:',
        'copy_button': 'Copy',
        'share_info': 'This link will be active for 24 hours and saves all entered data',
        
        // GPA Calculator
        'gpa_title': '📊 GPA Calculator',
        'gpa_description': 'Calculation of weighted GPA with credits',
        'gpa_formula': 'GPA = Σ(grade points × credits) / Σ(credits)',
        'subjects_count': 'Number of subjects:',
        'generate_subjects': 'Generate form for subjects',
        'gpa_warning': '⚠️ Important: Enter correct data for all subjects!',
        
        // Grade Converter
        'converter_title': '🔄 Grade to GPA Converter',
        'converter_description': 'Convert percentage grade to GPA',
        'percentage_label': 'Final grade in percentage (%):',
        'percentage_placeholder': 'Example: 85',
        'convert_btn': 'Convert to GPA',
        
        // Support page
        'support_title': '🤝 Support the Project',
        'support_description': '❤️ GradeMaster is a free non-commercial project for students',
        'kaspi_title': '🇰🇿 Kaspi transfer',
        'kaspi_card': 'Card number:',
        'yoomoney_title': '💰 YooMoney (Yandex.Money)',
        'yoomoney_wallet': 'Wallet:',
        'bank_title': '💳 Bank transfer',
        'bank_details': 'Details:',
        'copy_btn': 'Copy',
        'quick_transfer': '📱 Quick transfer via Kaspi',
        'qr_description': 'Scan QR code to open Kaspi app with filled details:',
        'select_amount': 'Select amount (₸):',
        'custom_amount': 'Custom amount',
        'generate_qr': '✨ Generate QR code',
        'important_info': 'ℹ️ Important information:',
        'support_warning': 'This is voluntary support for a non-commercial project. All calculators remain completely free.',
        'thank_you': '🙏 Thank you for your support!',
        
        // Footer
        'footer_copyright': '&copy; 2025 Not_404. In case of any bug contact via Telegram',
        
        // Calculator results
        'error_empty': '❌ Please enter all values for calculation.',
        'error_invalid': '❌ Error: All grades must be in range 0-100',
        'success_scholarship': '✅ Success! Regular scholarship!',
        'success_high_scholarship': '💎 Excellent! Increased scholarship!',
        'warning_pass': '⚠️ No scholarship',
        'danger_fail': '❌ Failed',
        
        // Mode names and messages
        'mode_serious': 'Serious mode',
        'mode_standard': 'Standard mode',
        'mode_evil': 'Evil upperclassman',
        'mode_serious_msg': 'Serious analyst mode.',
        'mode_standard_msg': 'Standard mode. All business.',
        'mode_evil_msg': 'Evil upperclassman mode.',
        
        // Serious mode messages
        'empty_msg_1': 'Please enter all values for calculation.',
        'empty_msg_2': 'All fields must be filled for accurate results.',
        'invalid_msg_1': 'Enter valid values from 0 to 100.',
        'invalid_msg_2': 'Invalid data, check the grades range.',
        'pass_msg_1': 'Fill in all fields for calculation.',
        'pass_msg_2': 'Do not forget to enter all grades.',
        'prediction_msg_1': 'Forecast of required points on final exam.',
        'prediction_msg_2': 'Let\'s see how many points you need on the final.',
        
        // Standard mode messages
        'standard_empty_1': 'Fill in all fields for calculation.',
        'standard_empty_2': 'Do not forget to enter all grades.',
        'standard_invalid_1': 'Grades must be from 0 to 100.',
        'standard_invalid_2': 'Invalid value, check the range.',
        'standard_pass_1': 'You passed the course. Final grade is normal.',
        'standard_pass_2': 'Course completed successfully, congratulations!',
        'standard_fail_1': 'Unfortunately, the result is below passing score.',
        'standard_fail_2': 'Retake is necessary, time to resit.',
        'standard_scholarship_1': 'Congratulations! You get a scholarship.',
        'standard_scholarship_2': 'Scholarship is yours, well done!',
        'standard_high_scholarship_1': 'Excellent! You get an increased scholarship!',
        'standard_high_scholarship_2': 'Highest result! Increased scholarship guaranteed!',
        'standard_high_1': 'Excellent result! You showed high level of knowledge.',
        'standard_high_2': 'Excellent! Keep it up.',
        'already_failed_1': 'Based on current results, passing is impossible.',
        'already_failed_2': 'Even a perfect final will not save the situation.',
        
        // Evil mode messages
        'evil_empty_1': 'Did you seriously forget to enter numbers? Or do I need to explain this too?',
        'evil_empty_2': 'Nothing entered. Seriously?',
        'evil_invalid_1': 'Grades from 0 to 100, not from minus infinity to 200. Did you study math?',
        'evil_invalid_2': 'Invalid data. Are you even in this course?',
        'evil_pass_1': 'You barely passed. Congratulations on the minimum result.',
        'evil_pass_2': 'Well, you did it. Almost a miracle.',
        'evil_fail_1': 'Retake. Not painful, I just calculated. See you on retake!',
        'evil_fail_2': 'You failed. At least it was predictable.',
        'evil_scholarship_1': 'You got a scholarship! Do not spend it on coffee on the first day.',
        'evil_scholarship_2': 'Congratulations, scholarship is yours!',
        'evil_high_scholarship_1': 'Seriously? Increased scholarship? You did not cheat?',
        'evil_high_scholarship_2': 'Did not expect this from you!',
        'evil_high_1': 'Outstanding! At least you can do something right.',
        'evil_high_2': 'Actually impressed. Keep going.',
        'evil_already_failed_1': 'Current results are not promising.',
        'evil_already_failed_2': 'Even 100 on final will not help. Retake guaranteed.',
        'impossible_scholarship': 'Need more than 100 points. Maybe try a bribe? Just joking... or not 🤔',
        
        // Attendance calculator
        'att_error': 'Error',
        'att_please_enter': 'Please enter the number of pairs per week.',
        'att_range_error': 'Number of pairs must be from 1 to 50.',
        
        // GPA Calculator messages
        'gpa_correct_count': 'Please enter the correct number of subjects (1-20)',
        'gpa_fill_all': 'Please check entered data. All fields must be filled correctly.',
        'gpa_insufficient': 'Insufficient data for calculation. Add at least one subject with credits and grade.',
        'gpa_overall': 'Overall GPA (weighted):',
        
        // Template calculator
        'template_excellent': 'Excellent!',
        'template_excellent_comment': 'Excellent result!',
        'template_good': 'Good',
        'template_good_comment': 'Course completed successfully!',
        'template_satisfactory': 'Satisfactory',
        'template_satisfactory_comment': 'Course passed, but there is room to grow',
        'template_unsatisfactory': 'Unsatisfactory',
        'template_unsatisfactory_comment': 'Retake required',
        'template_overall_result': 'Overall result:',

        // Cumulative GPA calculator
        'cumulative_title': '📊 Cumulative GPA Calculator',
        'cumulative_desc': 'Calculate cumulative GPA across multiple trimesters',
        'terms_count': 'Number of trimesters:',
        'generate_terms': 'Generate form for trimesters',
        'cumulative_results': '📋 Calculation Results',
        'cumulative_term': 'Trimester',
        'cumulative_gpa': 'GPA',
        'cumulative_credits': 'Credits',
        'gpa_warning': '⚠️ Important: Enter correct data for all trimesters!',
        'calculate_btn': 'Calculate',
        'cumulative_weighted': 'GPA × Credits',
        'cumulative_total': 'Overall GPA (weighted):',
        'sigma_gpa_credits': 'Σ(GPA × credits)',
        'sigma_credits': 'Σ(credits)',
        'term_gpa_placeholder': 'Trimester GPA',
        'term_credits_placeholder': 'Credits',
        
        // Feedback messages
        'feedback_type_suggestion': 'Suggestion',
        'feedback_type_bug': 'Bug report',
        'feedback_type_feature': 'Feature request',
        'feedback_type_other': 'Other',
        'feedback_sending': 'Sending...',
        'feedback_error': 'Error sending message',
        'feedback_success': 'Thank you for your feedback!',
        'feedback_success_contact': 'We will contact you soon!',
        
        // Additional strings from total.js
        'regmid_below_25': 'RegMid < 25? Seriously? Do you even attend classes? 💀',
        'regmid_below_minimum': 'RegMid is below minimum threshold. Course cannot be completed.',
        'regmid_below_25_standard': 'RegMid is less than 25. Retake is inevitable.',
        'regend_below_25_evil': 'RegEnd < 25... Seems like someone skipped important lectures. Or all of them.',
        'regend_below_25_serious': 'RegEnd is below minimum threshold. Course cannot be completed.',
        'regend_below_25_standard': 'RegEnd is less than 25. Retake is inevitable.',
        'regterm_direct_input': ' (entered directly)',
        'regterm_below_50': 'RegTerm < 50. Congratulations, you did not even reach final and already have a retake!',
        'regterm_below_50_serious': 'RegTerm is below minimum threshold. Course cannot be completed.',
        'regterm_below_50_standard': 'RegTerm is less than 50. Retake is inevitable.',
        'retake_evil': 'Final is between 25 and 50. Fate gave a second chance, do not mess up.',
        'retake_serious': 'Exam not passed, but retake opportunity is provided.',
        'retake_standard': 'Retake. You have a second chance.',
        'prediction_title': '🔮 Forecast',
        'regterm_display': 'RegTerm: {value}{source}',
        'critical_check': 'Critical conditions check',
        'impossible_pass': 'Impossible (need {value} > 100)',
        'for_regular_scholarship': 'For regular scholarship:',
        'minimum_points': 'Minimum {value} points',
        'for_high_scholarship': 'For increased scholarship:',
        'higher_scholarship': 'Increased scholarship not possible',
        'impossible_scholarship_evil': 'Need more than 100 points. Maybe try a bribe? Just joking... or not 🤔',
        'impossible_scholarship_standard': 'Impossible to get a scholarship with current results.',
        'impossible_scholarship_serious': 'Impossible to get a scholarship with current results.',
        'failed_title': '❌ Retake',
        'retake_title': '⚠️ Retake',
        'pass_title': '⚠️ No scholarship',
        'scholarship_title': '✅ Success! Regular scholarship!',
        'high_scholarship_title': '💎 Excellent! Increased scholarship!',
        'details_calculation': 'Calculation details: RegTerm = {regterm}, Final score = {total}',
        'details_calculation_evil': 'Details: RegTerm = {regterm}, Total = {total}',
        'invalid_link': '❌ Link is invalid or expired',
        'expired_link': '❌ Link has expired',
        
        // Secret messages from template.js and total.js
        'secret_manual_check': 'Secret advice: always double-check calculations manually!',
        'secret_rare_user': 'You are 1 in 1000 users who found this easter egg!',
        'secret_easter_egg': 'Congratulations egg hunter, maybe there\'s something on other pages too?)',
        'secret_auto_passing': 'Auto-passing exam function is still in development...',
        'secret_calculator_student': 'Know why this calculator is so accurate? It never cheated on exams!',
        'secret_calculator_scholarship': 'If this calculator were a student, it would have a scholarship!',
        'secret_leak': 'Warning! Leak detected: final is 40% of the grade!',
        'secret_hack': 'Hacker advice: to pass the exam, you need to show up to it 😉',
        'secret_success': 'Secret to success: 10% luck, 20% skills, 70% this calculator!',
        'secret_warning': 'Warning: excessive use of the calculator may lead to... good grades!',
        'secret_difference': 'Know the difference between a student and this calculator? Calculator always calculates correctly!',
        'secret_excuse': 'Congratulations! You found an excuse not to prepare for the exam!',
        
        // Messages from att.js  
        'att_note': 'Note: The actual number of allowed absences may depend on the specific subject, check the syllabus of this course.',
        
        // Mode comments
        'evil_pass_comment_hard': ' (Wow! This will be DIFFICULT)',
        'evil_pass_comment_medium': ' (Get ready to live in the library)',
        'evil_pass_comment_easy': ' (Quite real)',
        'serious_pass_comment': '',
        'standard_pass_comment_hard': ' (very difficult)',
        'standard_pass_comment_medium': ' (good preparation needed)',
        'standard_pass_comment_easy': ' (achievable)',
        'evil_scholarship_comment_fantasy': ' (This is already fantasy!)',
        'evil_scholarship_comment_hard': ' (On the edge of possibility!)',
        'evil_scholarship_comment_medium': ' (Incredible effort needed)',
        'serious_scholarship_comment_hard': ' (extremely difficult)',
        'serious_scholarship_comment_medium': ' (very high difficulty)',
        'serious_scholarship_comment_easy': ' (high difficulty)',
        'standard_scholarship_comment_hard': ' (very high bar)',
        'standard_scholarship_comment_medium': ' (serious preparation)',
        'standard_scholarship_comment_easy': ' (good chance)',
        'evil_high_scholarship_comment_fantasy': ' (Start praying 🙏)',
        'evil_high_scholarship_comment_hard': ' (Study EVERYTHING!)',
        'evil_high_scholarship_comment_easy': ' (It\'s real!)'
    }
};

// Функция для получения перевода
function getTranslation(key) {
    return translations[currentLanguage]?.[key] || translations['ru']?.[key] || key;
}

// Текущий язык
let currentLanguage = 'ru';

// Функция переключения языка
function switchLanguage(lang) {
    currentLanguage = lang;
    localStorage.setItem('language', lang);
    applyTranslations();
    updateLanguageButton();
    updateHtmlLang();
    
    // Обновляем таблицу результатов, если функция существует
    if (typeof updateTableLanguage === 'function') {
        updateTableLanguage();
    }
}

// Применение переводов
function applyTranslations() {
    const langData = translations[currentLanguage];
    
    // Находим все элементы с атрибутом data-translate
    document.querySelectorAll('[data-translate]').forEach(element => {
        const key = element.getAttribute('data-translate');
        
        if (langData[key]) {
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                // Для input и textarea меняем placeholder
                if (element.getAttribute('data-translate-type') === 'placeholder') {
                    element.placeholder = langData[key];
                } else {
                    // Иначе меняем value
                    element.value = langData[key];
                }
            } else if (element.tagName === 'OPTION') {
                // Для option меняем текст
                element.textContent = langData[key];
            } else {
                // Для остальных элементов меняем текст
                element.textContent = langData[key];
            }
        }
    });
    
    // Обновляем элементы без data-translate, но с ID
    updateElementsById(langData);
    
    // Обновляем page title основываясь на текущей странице
    updatePageTitle(langData);
}

// Обновление элементов по ID
function updateElementsById(langData) {
    const elements = {
        'theme-toggle': 'nav_theme',
        'language-toggle': 'nav_language',
        'mode-toggle': 'nav_mode',
        'currentModeDisplay': 'current_mode'
    };
    
    for (const [id, key] of Object.entries(elements)) {
        const element = document.getElementById(id);
        if (element && langData[key]) {
            if (id === 'currentModeDisplay') {
                // Для отображения режима сохраняем текущий режим
                const modeText = element.textContent.replace(/Текущий режим:|Current mode:/, '').trim();
                element.textContent = `${langData[key]} ${modeText}`;
            } else {
                element.textContent = langData[key];
            }
        }
    }
}

// Обновление кнопки переключения языка
function updateLanguageButton() {
    const button = document.getElementById('language-toggle');
    if (button) {
        button.textContent = currentLanguage === 'ru' ? '🌐 Eng' : '🌐 Рус';
    }
}

// Обновление атрибута lang у html
function updateHtmlLang() {
    document.documentElement.lang = currentLanguage;
}

// Обновление page title основываясь на текущей странице
function updatePageTitle(langData) {
    const currentPath = window.location.pathname.toLowerCase();
    let titleKey = 'main_title';
    
    if (currentPath.includes('totalcalculator')) {
        titleKey = 'page_title_total';
    } else if (currentPath.includes('gpa')) {
        titleKey = 'page_title_gpa';
    } else if (currentPath.includes('attendance') || currentPath.includes('attendancecalculator')) {
        titleKey = 'page_title_attendance';
    } else if (currentPath.includes('feedback')) {
        titleKey = 'page_title_feedback';
    } else if (currentPath.includes('templated') || currentPath.includes('template')) {
        titleKey = 'page_title_template';
    }
    
    if (langData[titleKey]) {
        document.title = langData[titleKey];
    }
}

// Инициализация языка при загрузке
function initLanguage() {
    // Проверяем сохраненный язык
    const savedLanguage = localStorage.getItem('language');
    
    // Определяем язык браузера
    const browserLanguage = navigator.language || navigator.userLanguage;
    
    // Устанавливаем язык
    if (savedLanguage) {
        currentLanguage = savedLanguage;
    } else if (browserLanguage.startsWith('en')) {
        currentLanguage = 'en';
    }
    
    // Применяем переводы
    applyTranslations();
    updateLanguageButton();
    updateHtmlLang();
    
    // Добавляем обработчик клика на кнопку переключения языка
    const languageButton = document.getElementById('language-toggle');
    if (languageButton) {
        languageButton.addEventListener('click', () => {
            const newLanguage = currentLanguage === 'ru' ? 'en' : 'ru';
            switchLanguage(newLanguage);
        });
    }
}

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', initLanguage);