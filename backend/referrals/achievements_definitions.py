"""
Static registry for achievements MVP (
``start``, ``links``, ``leads``, ``earnings``, ``game``, ``activity``, ``rating`` blocks).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AchievementDefinition:
    code: str
    title: str
    description: str
    category: str
    xp_reward: int
    target: int
    rarity: str


START_ACHIEVEMENTS: tuple[AchievementDefinition, ...] = (
    AchievementDefinition(
        code="FIRST_PROGRAM_JOINED",
        title="Первый шаг",
        description="Вступить в первую программу",
        category="start",
        xp_reward=25,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="FIRST_REFERRAL_LINK",
        title="Ссылка получена",
        description="Получить первую реферальную ссылку",
        category="start",
        xp_reward=25,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="PROFILE_COMPLETED",
        title="Профиль на месте",
        description="Заполнить профиль",
        category="start",
        xp_reward=30,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="THREE_PROGRAMS_JOINED",
        title="Выбор сделан",
        description="Вступить в 3 программы",
        category="start",
        xp_reward=75,
        target=3,
        rarity="rare",
    ),
)

LINK_ACHIEVEMENTS: tuple[AchievementDefinition, ...] = (
    AchievementDefinition(
        code="FIRST_CLICK",
        title="Первый клик",
        description="Получить 1 переход по ссылке",
        category="links",
        xp_reward=25,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="CLICKS_10",
        title="Люди идут",
        description="Получить 10 переходов по ссылке",
        category="links",
        xp_reward=50,
        target=10,
        rarity="common",
    ),
    AchievementDefinition(
        code="CLICKS_50",
        title="Трафик пошёл",
        description="Получить 50 переходов по ссылке",
        category="links",
        xp_reward=100,
        target=50,
        rarity="rare",
    ),
    AchievementDefinition(
        code="CLICKS_100",
        title="Золотая ссылка",
        description="Получить 100 переходов по ссылке",
        category="links",
        xp_reward=150,
        target=100,
        rarity="rare",
    ),
    AchievementDefinition(
        code="CLICKS_250",
        title="Магнит для клиентов",
        description="Получить 250 переходов по ссылке",
        category="links",
        xp_reward=250,
        target=250,
        rarity="epic",
    ),
)

LEADS_ACHIEVEMENTS: tuple[AchievementDefinition, ...] = (
    AchievementDefinition(
        code="FIRST_CONFIRMED_LEAD",
        title="Первый клиент",
        description="Получить 1 подтверждённого лида",
        category="leads",
        xp_reward=150,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="CONFIRMED_LEADS_3",
        title="Есть контакт",
        description="Получить 3 подтверждённых лида",
        category="leads",
        xp_reward=200,
        target=3,
        rarity="rare",
    ),
    AchievementDefinition(
        code="CONFIRMED_LEADS_5",
        title="Результат есть",
        description="Получить 5 подтверждённых лидов",
        category="leads",
        xp_reward=300,
        target=5,
        rarity="rare",
    ),
    AchievementDefinition(
        code="CONFIRMED_LEADS_10",
        title="Приводишь стабильно",
        description="Получить 10 подтверждённых лидов",
        category="leads",
        xp_reward=500,
        target=10,
        rarity="epic",
    ),
    AchievementDefinition(
        code="LEADS_IN_3_PROGRAMS",
        title="Серийный агент",
        description="Получить лиды в 3 разных программах",
        category="leads",
        xp_reward=500,
        target=3,
        rarity="epic",
    ),
    AchievementDefinition(
        code="HOT_WEEK",
        title="Горячая неделя",
        description="Получить 5 лидов за 7 дней",
        category="leads",
        xp_reward=600,
        target=5,
        rarity="epic",
    ),
)

EARNINGS_ACHIEVEMENTS: tuple[AchievementDefinition, ...] = (
    AchievementDefinition(
        code="FIRST_COMMISSION",
        title="Первая комиссия",
        description="Получить первое начисление",
        category="earnings",
        xp_reward=200,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="EARNED_1000",
        title="Первые 1 000 ₽",
        description="Заработать 1 000 ₽",
        category="earnings",
        xp_reward=250,
        target=1000,
        rarity="rare",
    ),
    AchievementDefinition(
        code="EARNED_5000",
        title="Уже серьёзно",
        description="Заработать 5 000 ₽",
        category="earnings",
        xp_reward=600,
        target=5000,
        rarity="epic",
    ),
    AchievementDefinition(
        code="EARNED_10000",
        title="Партнёрский доход",
        description="Заработать 10 000 ₽",
        category="earnings",
        xp_reward=1000,
        target=10000,
        rarity="epic",
    ),
    AchievementDefinition(
        code="FIRST_WITHDRAWAL",
        title="Первый вывод",
        description="Заказать первый вывод средств",
        category="earnings",
        xp_reward=300,
        target=1,
        rarity="rare",
    ),
)

GAME_ACHIEVEMENTS: tuple[AchievementDefinition, ...] = (
    AchievementDefinition(
        code="FIRST_GAME",
        title="Первый запуск",
        description="Сыграть первую партию",
        category="game",
        xp_reward=25,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="FIRST_LINE_CLEAR",
        title="Чистая линия",
        description="Очистить первую линию",
        category="game",
        xp_reward=25,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="DOUBLE_LINE_CLEAR",
        title="Двойная очистка",
        description="Очистить 2 линии за один ход",
        category="game",
        xp_reward=75,
        target=2,
        rarity="rare",
    ),
    AchievementDefinition(
        code="COMBO_X3",
        title="Комбо x3",
        description="Сделать комбо x3",
        category="game",
        xp_reward=100,
        target=3,
        rarity="rare",
    ),
    AchievementDefinition(
        code="SCORE_500",
        title="Хорошая партия",
        description="Набрать 500 очков",
        category="game",
        xp_reward=75,
        target=500,
        rarity="common",
    ),
    AchievementDefinition(
        code="SCORE_1500",
        title="Сильная партия",
        description="Набрать 1500 очков",
        category="game",
        xp_reward=200,
        target=1500,
        rarity="rare",
    ),
    AchievementDefinition(
        code="SCORE_3000",
        title="Мастер блоков",
        description="Набрать 3000 очков",
        category="game",
        xp_reward=500,
        target=3000,
        rarity="epic",
    ),
)

ACTIVITY_ACHIEVEMENTS: tuple[AchievementDefinition, ...] = (
    AchievementDefinition(
        code="STREAK_3_DAYS",
        title="Серия 3 дня",
        description="Быть активным 3 дня подряд",
        category="activity",
        xp_reward=75,
        target=3,
        rarity="common",
    ),
    AchievementDefinition(
        code="STREAK_7_DAYS",
        title="Неделя без остановки",
        description="Быть активным 7 дней подряд",
        category="activity",
        xp_reward=200,
        target=7,
        rarity="rare",
    ),
    AchievementDefinition(
        code="STREAK_14_DAYS",
        title="Не сбавляешь темп",
        description="Быть активным 14 дней подряд",
        category="activity",
        xp_reward=400,
        target=14,
        rarity="epic",
    ),
    AchievementDefinition(
        code="RETURN_AFTER_7_DAYS",
        title="Возвращение",
        description="Вернуться после 7 дней без активности",
        category="activity",
        xp_reward=50,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="ACTIVE_DAYS_10",
        title="Постоянный участник",
        description="Быть активным 10 разных дней",
        category="activity",
        xp_reward=250,
        target=10,
        rarity="rare",
    ),
)

RATING_ACHIEVEMENTS: tuple[AchievementDefinition, ...] = (
    AchievementDefinition(
        code="ENTERED_RANKING",
        title="Вошёл в рейтинг",
        description="Попасть в общий рейтинг",
        category="rating",
        xp_reward=50,
        target=1,
        rarity="common",
    ),
    AchievementDefinition(
        code="TOP_100",
        title="Топ-100",
        description="Попасть в топ-100 общего рейтинга",
        category="rating",
        xp_reward=150,
        target=100,
        rarity="common",
    ),
    AchievementDefinition(
        code="TOP_50",
        title="Топ-50",
        description="Попасть в топ-50 общего рейтинга",
        category="rating",
        xp_reward=250,
        target=50,
        rarity="rare",
    ),
    AchievementDefinition(
        code="TOP_10_WEEK",
        title="Топ-10 недели",
        description="Попасть в топ-10 недельного рейтинга",
        category="rating",
        xp_reward=500,
        target=10,
        rarity="epic",
    ),
    AchievementDefinition(
        code="TOP_3_WEEK",
        title="Топ-3 недели",
        description="Попасть в топ-3 недельного рейтинга",
        category="rating",
        xp_reward=900,
        target=3,
        rarity="epic",
    ),
    AchievementDefinition(
        code="FIRST_PLACE_WEEK",
        title="Лучший за неделю",
        description="Занять 1 место недельного рейтинга",
        category="rating",
        xp_reward=1500,
        target=1,
        rarity="legendary",
    ),
)

ALL_ACHIEVEMENTS: tuple[AchievementDefinition, ...] = (
    START_ACHIEVEMENTS
    + LINK_ACHIEVEMENTS
    + LEADS_ACHIEVEMENTS
    + EARNINGS_ACHIEVEMENTS
    + GAME_ACHIEVEMENTS
    + ACTIVITY_ACHIEVEMENTS
    + RATING_ACHIEVEMENTS
)

_BY_CODE: dict[str, AchievementDefinition] = {a.code: a for a in ALL_ACHIEVEMENTS}


def get_achievement_definition(code: str) -> AchievementDefinition | None:
    return _BY_CODE.get(code)


def get_start_definition(code: str) -> AchievementDefinition | None:
    """Backward-compatible alias; prefer ``get_achievement_definition``."""
    return get_achievement_definition(code)
