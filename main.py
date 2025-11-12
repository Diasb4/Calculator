import random

# Саркастичные комментарии для разных ситуаций
SARCASTIC_COMMENTS = {
    'welcome': [
        "Добро пожаловать в калькулятор судьбы! Надеюсь, вы готовы к правде...",
        "Итак, пришло время узнать, насколько плохи ваши дела 📉",
        "Давайте посмотрим, будете ли вы есть дошик этим летом...",
    ],
    'already_failed_regmid': [
        "РегМид < 25? Серьёзно? Вы вообще на пары ходили? 💀",
        "РегМид меньше 25... Ну что ж, лето будет жарким. И учебным.",
        "РегМид < 25. Даже файнал на 100 вас не спасёт. Спасибо, что попытались!",
    ],
    'already_failed_regend': [
        "РегЭнд < 25... Кажется, кто-то пропустил пару важных лекций. Или все.",
        "РегЭнд меньше 25. Файнал теперь просто формальность 🎭",
        "25 баллов на РегЭнд набрать не смогли? Интересная стратегия...",
    ],
    'already_failed_regterm': [
        "РегТерм < 50. Поздравляю, вы провалили семестр ДО экзамена! Это талант.",
        "РегТерм меньше 50... Летник неизбежен, как понедельник после воскресенья.",
        "РегТерм < 50. Файнал можете даже не писать, но попробуйте для опыта 😏",
    ],
    'need_high_score': [
        "Вам нужно {score:.1f} на файнал. Удачи, вы в неё верите? 🍀",
        "Для стипендии нужно {score:.1f}. Начинайте молиться всем богам сразу 🙏",
        "Нужно {score:.1f} баллов. Время превратиться в ботаника!",
    ],
    'impossible': [
        "Для стипендии нужно больше 100 баллов. Может, попробуете взятку? Шучу... или нет 🤔",
        "Нужно {score:.1f} > 100. Физика не позволяет. Математика тоже.",
        "Невозможно получить стипендию. Но эй, мечтать не вредно!",
    ],
    'final_too_low': [
        "Файнал < 25? Вы вообще на экзамен пришли или это был двойник? 👻",
        "25 баллов на файнал не набрать... это надо постараться!",
        "Файнал меньше 25. Летник. Следующий!",
    ],
    'retake': [
        "Пересдача! По крайней мере, вы не на летник. Пока. 😅",
        "Файнал 25-49... Вы на грани, как всегда. Пересдача ждёт!",
        "Поздравляю с пересдачей! Вторая попытка - это почти успех, правда?",
    ],
    'no_scholarship': [
        "Прошли, но без стипендии. Дошик будет вашим лучшим другом 🍜",
        "Тотал < 70. Стипендия пролетела мимо, как и ваша мотивация.",
        "Без стипендии, но хотя бы не летник! Празднуем? Нет, не празднуем.",
    ],
    'success': [
        "ВАУ! Вы реально прошли СО СТИПЕНДИЕЙ! Купите лотерейный билет! 🎰",
        "Стипендия! Теперь можно позволить себе что-то лучше дошика! 🎉",
        "Поздравляю! Вы в топ-1% студентов, которые читают учебники!",
        "Стипендия ваша! Родители будут гордиться. На этой неделе.",
    ],
    'total_fail': [
        "Тотал < 50. Летник. Встретимся здесь же в следующем году! 👋",
        "Летник confirmed. Надеюсь, вы любите лето? Учебное лето.",
        "Тотал меньше 50... Добро пожаловать на летнюю сессию-2026!",
    ],
    'prediction_ok': [
        "Ну что ж, у вас ещё есть шанс! Маленький. Крошечный. Но есть! 💪",
        "Математика говорит, что вы можете спастись. Математика иногда врёт, но попробуйте!",
        "Теоретически, вы не проиграли. Практически... ну, удачи!",
    ],
}

def get_random_comment(category, **kwargs):
    """Получить случайный комментарий из категории"""
    comment = random.choice(SARCASTIC_COMMENTS[category])
    if kwargs:
        return comment.format(**kwargs)
    return comment


def calculate_grades():
    """Калькулятор итоговой оценки с чёрным юмором"""
    
    print("=" * 60)
    print(get_random_comment('welcome'))
    print("=" * 60)
    print()
    
    try:
        regmid = float(input("Введите РегМид (0-100): "))
        regend = float(input("Введите РегЭнд (0-100): "))
        final = float(input("Введите Файнал (0-100, или 0 для прогноза судьбы): "))
        
        # Проверка диапазона
        if not (0 <= regmid <= 100 and 0 <= regend <= 100 and 0 <= final <= 100):
            print("\n❌ Эй, цифры от 0 до 100! Это не ракетостроение!")
            return
        
        # Расчёт РегТерм
        regterm = (regmid + regend) / 2
        
        print("\n" + "=" * 60)
        
        # Режим прогноза (если Файнал = 0)
        if final == 0:
            print("🔮 ПРЕДСКАЗЫВАЮ ВАШУ СУДЬБУ...")
            print("=" * 60)
            print(f"\nРегТерм: {regterm:.2f}", end="")
            
            if regterm >= 70:
                print(" (Неплохо! Может, вы и правда учитесь?)")
            elif regterm >= 50:
                print(" (На грани, как всегда...)")
            else:
                print(" (Ой... это плохо)")
            
            print()
            
            # Проверка критических условий
            if regmid < 25:
                print("\n💀 " + get_random_comment('already_failed_regmid'))
                print("\nВердикт: ЛЕТНИК БЕЗ ВАРИАНТОВ")
            elif regend < 25:
                print("\n💀 " + get_random_comment('already_failed_regend'))
                print("\nВердикт: ЛЕТНИК БЕЗ ВАРИАНТОВ")
            elif regterm < 50:
                print("\n💀 " + get_random_comment('already_failed_regterm'))
                print("\nВердикт: ЛЕТНИК БЕЗ ВАРИАНТОВ")
            else:
                print(get_random_comment('prediction_ok'))
                print()
                
                # Расчёт необходимых баллов
                reg_score = (regmid * 0.3) + (regend * 0.3)
                
                # Для прохода без пересдачи
                min_for_pass_calc = (50 - reg_score) / 0.4
                min_for_pass = max(50, min_for_pass_calc)
                
                # Для стипендии
                min_for_scholarship = (70 - reg_score) / 0.4
                
                print("📊 ЧТО ВАМ НУЖНО НАБРАТЬ:")
                print("-" * 60)
                
                if min_for_pass > 90:
                    print(f"🔥 Для прохода: {min_for_pass:.1f} (Ого! Это будет СЛОЖНО)")
                elif min_for_pass > 70:
                    print(f"🟡 Для прохода: {min_for_pass:.1f} (Готовьтесь жить в библиотеке)")
                else:
                    print(f"🟢 Для прохода: {min_for_pass:.1f} (Вполне реально, если постараться)")
                
                print()
                
                if min_for_scholarship <= 100:
                    scholarship_score = max(50, min_for_scholarship)
                    if scholarship_score > 95:
                        print(f"💎 Для стипендии: {scholarship_score:.1f}")
                        print(get_random_comment('need_high_score', score=scholarship_score))
                    elif scholarship_score > 80:
                        print(f"⭐ Для стипендии: {scholarship_score:.1f}")
                        print("   (Придётся выучить всё. ВСЁ!)")
                    else:
                        print(f"✨ Для стипендии: {scholarship_score:.1f}")
                        print("   (Это реально! Просто позанимайтесь!)")
                else:
                    print(f"💀 " + get_random_comment('impossible', score=min_for_scholarship))
                
                print("\n" + "-" * 60)
                print("📖 СПРАВОЧНИК ДЛЯ ТЕХ, КТО ЗАБЫЛ:")
                print("   • Файнал < 25 → Летник (не приходите даже)")
                print("   • Файнал 25-49 → Пересдача (второй шанс!)")
                print("   • Файнал ≥ 50 и Тотал < 50 → Летник (так близко...)")
                print("   • Файнал ≥ 50 и Тотал < 70 → Без стипендии (дошик ждёт)")
                print("   • Тотал ≥ 70 → СТИПЕНДИЯ! (мечта!)")
        
        # Обычный расчёт с реальным Файналом
        else:
            total = (regmid * 0.3) + (regend * 0.3) + (final * 0.4)
            
            print("⚖️  СУДНЫЙ ДЕНЬ")
            print("=" * 60)
            print(f"\n💯 Тотал: {total:.2f}", end="")
            
            if total >= 90:
                print(" (Да вы гений!)")
            elif total >= 70:
                print(" (Стипендия! Родители будут рады!)")
            elif total >= 50:
                print(" (Прошли... но как-то грустно)")
            else:
                print(" (F в чат)")
            
            print(f"📊 РегТерм: {regterm:.2f}")
            print()
            print("-" * 60)
            
            # Проверка всех условий с комментариями
            if regmid < 25:
                print("❌ ЛЕТНИК")
                print(get_random_comment('already_failed_regmid'))
            elif regend < 25:
                print("❌ ЛЕТНИК")
                print(get_random_comment('already_failed_regend'))
            elif regterm < 50:
                print("❌ ЛЕТНИК")
                print(get_random_comment('already_failed_regterm'))
            elif final < 25:
                print("❌ ЛЕТНИК")
                print(get_random_comment('final_too_low'))
            elif total < 50:
                print("❌ ЛЕТНИК")
                print(get_random_comment('total_fail'))
            elif 25 <= final < 50:
                print("⚠️  ПЕРЕСДАЧА")
                print(get_random_comment('retake'))
            elif total < 70:
                print("⚠️  ПРОШЛИ, НО БЕЗ СТИПЕНДИИ")
                print(get_random_comment('no_scholarship'))
            else:
                print("✅ УСПЕХ! СТИПЕНДИЯ!")
                print(get_random_comment('success'))
        
        print("\n" + "=" * 60)
        print("⚠️  НАПОМИНАЮ: Списывание = ОТЧИСЛЕНИЕ")
        print("   (Но вы же не будете, правда? ...Правда?)")
        print("=" * 60)
        
    except ValueError:
        print("\n❌ Это должны быть ЦИФРЫ! Вы в универ поступали как?")
    except Exception as e:
        print(f"\n💥 Что-то пошло не так: {e}")
        print("Может, это знак свыше? 🤔")


def main():
    """Главная функция с возможностью повторных расчётов"""
    while True:
        calculate_grades()
        print()
        repeat = input("🎲 Хотите узнать судьбу ещё кого-то? (да/нет): ").lower()
        if repeat not in ['да', 'yes', 'д', 'y']:
            print("\n👋 Пока! Не забывайте учиться!")
            print("   (Или хотя бы делайте вид)")
            break
        print("\n" * 2)


if __name__ == "__main__":
    main()