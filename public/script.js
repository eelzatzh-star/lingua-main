'use strict';

const GLOSSARY = [
  { term: 'Кринж', category: 'Сленг', keys: 'cringe стыд неловкость стыдно', meaning: 'Что-то настолько неловкое, странное или неуместное, что вызывает смущение — за себя или за другого человека.', reply: '«Понял(а). Что именно показалось тебе неловким?»' },
  { term: 'Вайб', category: 'Настроение', keys: 'vibe атмосфера чувство настроение энергетика', meaning: 'Общее впечатление от человека, места, события или музыки: настроение и атмосфера, которые трудно описать одним словом.', reply: '«Какое ощущение у тебя от этого места или человека?»' },
  { term: 'Токсик', category: 'Отношения', keys: 'токсичный давление манипуляция отношения', meaning: 'Человек или модель общения, рядом с которыми часто чувствуешь давление, вину, унижение или эмоциональное истощение. Само слово не заменяет разбор конкретных поступков.', reply: '«Что именно произошло и как это на тебя повлияло?»' },
  { term: 'Имба', category: 'Оценка', keys: 'imba круто классно мощно игра баланс имбаланс', meaning: 'Что-то очень сильное, эффективное или впечатляющее. Слово пришло из игрового жаргона от «имбаланс» — нарушения баланса.', reply: '«Вижу, тебе очень понравилось. Что в этом самое классное?»' },
  { term: 'Душнила', category: 'Общение', keys: 'занудный скучный придираться слишком серьёзный', meaning: 'Тот, кто чрезмерно придирается к мелочам, долго морализирует или делает непринуждённый разговор слишком тяжёлым.', reply: '«Кажется, я перегрузил(а) разговор деталями. Как объяснить проще?»' },
  { term: 'Сигма', category: 'Мемы', keys: 'sigma самостоятельный независимый образ мем', meaning: 'Интернет-образ самодостаточного человека, который действует независимо от группы. Часто используется иронично, как мем.', reply: '«Ты используешь это всерьёз или скорее как шутку?»' },
  { term: 'Редфлаг', category: 'Отношения', keys: 'red flag красный флаг тревожный сигнал опасность', meaning: 'Признак, который настораживает в поведении или отношениях: например, постоянный контроль, угрозы или неуважение к границам.', reply: '«Что именно кажется тревожным? Давай рассмотрим конкретный поступок».' },
  { term: 'Агриться', category: 'Эмоции', keys: 'агрессия злиться раздражаться anger', meaning: 'Сильно раздражаться, злиться или реагировать агрессивно. В игровом контексте также может означать намеренно привлекать внимание противника.', reply: '«Похоже, тебя это сильно задело. Хочешь рассказать почему?»' },
  { term: 'Рофл', category: 'Юмор', keys: 'rofl шутка смеяться прикол прикалываться', meaning: 'Шутка, прикол или ситуация, над которой смеются; «я рофлю» — «я шучу». Происходит от английского rolling on the floor laughing.', reply: '«А, ты шутишь. А что ты хотел(а) этим сказать?»' },
  { term: 'Лол', category: 'Переписка', keys: 'lol смех смешно удивление', meaning: 'Маркер смеха, удивления или лёгкой иронии. В сообщениях не всегда означает, что человек действительно смеётся.', reply: '«Я правильно понял(а), что тебя это рассмешило?»' },
  { term: 'ИМХО', category: 'Переписка', keys: 'imho мнение по моему скромному мнению', meaning: 'Сокращение от «по моему скромному мнению» (англ. in my humble opinion). Подчёркивает, что высказывается личная точка зрения.', reply: '«Понял(а), это твоё мнение. А какие аргументы за ним стоят?»' },
  { term: 'База', category: 'Оценка', keys: 'based правда согласие верно факт', meaning: 'Сленговая реакция на мысль, которую считают точной, смелой или заслуживающей согласия. Значение зависит от контекста и мемов.', reply: '«С чем именно ты согласен(на) в этой мысли?»' },
  { term: 'Краш', category: 'Отношения', keys: 'crush симпатия влюблённость нравится человек', meaning: 'Человек, который очень нравится или вызывает романтическую симпатию. Это не обязательно взаимные отношения.', reply: '«Похоже, этот человек тебе нравится. Хочешь об этом поговорить?»' },
  { term: 'Флексить', category: 'Самопрезентация', keys: 'flex хвастаться демонстрировать показывать статус', meaning: 'Показывать свои достижения, внешний вид, вещи или возможности — иногда просто делиться радостью, иногда хвастаться.', reply: '«Ты гордишься этим? Расскажи, как тебе удалось этого добиться».' },
  { term: 'Слэй', category: 'Похвала', keys: 'slay выглядеть круто успех отлично', meaning: 'Эмоциональная похвала за удачный образ, выступление, результат или смелый поступок: примерно «круто получилось».', reply: '«Кажется, это действительно было важно для тебя. Чем ты больше всего доволен(на)?»' },
  { term: 'Делулу', category: 'Мемы', keys: 'delulu иллюзии фантазия самообман', meaning: 'Шутливое сокращение от английского delusional — чрезмерно фантазировать или верить в желаемый сценарий вопреки фактам. Не медицинский термин.', reply: '«Ты мечтаешь об этом или действительно считаешь, что так и произойдёт?»' },
  { term: 'Тильт', category: 'Эмоции и игры', keys: 'tilt раздражение проигрыш сорваться фрустрация', meaning: 'Состояние сильного раздражения или расстройства после неудачи, когда из-за эмоций становится труднее принимать решения.', reply: '«Может, стоит сделать перерыв и вернуться, когда станет спокойнее?»' },
  { term: 'Зашквар', category: 'Оценка', keys: 'стыд позор неловкая ситуация репутация', meaning: 'Что-то, что в конкретной компании считают позорным, постыдным или сильно неуместным. Оценка субъективна и меняется между группами.', reply: '«Почему в вашей компании это считают зашкваром?»' },
  { term: 'Залетело', category: 'Соцсети', keys: 'вирусный ролик просмотры популярность тренд', meaning: 'Публикация или видео неожиданно набрали много просмотров, реакций и распространения.', reply: '«Что, по-твоему, помогло этому видео стать популярным?»' },
  { term: 'Зафорсить', category: 'Соцсети', keys: 'форс продвигать распространять мем тренд', meaning: 'Активно распространять тему, мем, песню или идею, чтобы о ней узнало больше людей.', reply: '«Это стало популярным само по себе или вы специально распространяли?»' },
  { term: 'Хейт', category: 'Интернет', keys: 'hate ненависть оскорбления травля негатив комментарии', meaning: 'Враждебная критика или оскорбительные сообщения. Не всякая критика — хейт: полезная критика объясняет конкретную проблему, не унижая человека.', reply: '«Это был конкретный отзыв или тебя пытались оскорбить?»' },
  { term: 'Буллинг', category: 'Безопасность', keys: 'травля издевательства унижение школа кибербуллинг', meaning: 'Повторяющаяся травля, унижение или преследование, часто при неравенстве сил. Это не просто единичная ссора и не то, что следует терпеть в одиночку.', reply: '«Спасибо, что рассказал(а). Ты не обязан(а) справляться с этим один(одна). Давай подумаем, кто может помочь».' },
  { term: 'Газлайтинг', category: 'Отношения', keys: 'газлайт манипуляция отрицать факты сомнения', meaning: 'Форма психологической манипуляции, при которой человек систематически отрицает события или искажает факты так, что другой начинает сомневаться в своей памяти и восприятии.', reply: '«Давай поговорим о конкретных событиях и о том, как ты себя чувствуешь».' },
  { term: 'Гостинг', category: 'Отношения', keys: 'ghosting исчезнуть игнорировать переписка отношения', meaning: 'Внезапно прекратить общение без объяснения, перестав отвечать на сообщения и звонки.', reply: '«Похоже, неопределённость тебя задевает. Что помогло бы тебе позаботиться о себе сейчас?»' },
  { term: 'Гринфлаг', category: 'Отношения', keys: 'green flag зелёный флаг здоровые отношения уважение', meaning: 'Положительный признак в отношениях: уважение границ, честность, способность признавать ошибки и спокойно обсуждать разногласия.', reply: '«Какие поступки помогают тебе чувствовать доверие и безопасность?»' },
  { term: 'Шипперить', category: 'Фандомы', keys: 'ship отношения пара персонажи фанаты', meaning: 'Представлять или поддерживать романтическую пару — в сериале, игре, книге или среди публичных персонажей.', reply: '«Тебе нравится их история или то, как они взаимодействуют?»' },
  { term: 'Фандом', category: 'Сообщества', keys: 'fan community фанаты сообщество интерес', meaning: 'Сообщество людей, объединённых интересом к артисту, книге, фильму, игре или другой теме.', reply: '«Что тебе больше всего нравится в этом сообществе?»' },
  { term: 'АФК', category: 'Игры', keys: 'afk away from keyboard отошёл не у компьютера', meaning: 'Сокращение от away from keyboard — человек временно отошёл от компьютера или не участвует в игре.', reply: '«Ты ненадолго отошёл или уже закончил играть?»' },
  { term: 'НПС', category: 'Игры и мемы', keys: 'npc персонаж без самостоятельности мем', meaning: 'В играх — персонаж, которым не управляет игрок (non-player character). В интернет-сленге так могут насмешливо назвать человека, который будто действует шаблонно; это может звучать обидно.', reply: '«Ты имеешь в виду конкретное поведение или просто используешь мем?»' },
  { term: 'Чиллить', category: 'Отдых', keys: 'chill отдыхать расслабляться ничего не делать', meaning: 'Расслабляться, отдыхать без спешки и давления.', reply: '«Как ты лучше всего восстанавливаешься после напряжённого дня?»' },
  { term: 'ПОВ / POV', category: 'Соцсети', keys: 'point of view точка зрения ситуация ролик', meaning: 'Сокращение от point of view — «точка зрения». В видео часто обозначает ситуацию, которую зрителю предлагают представить от первого лица.', reply: '«Какую ситуацию автор предлагает представить?»' },
  { term: 'Войс', category: 'Переписка', keys: 'voice голосовое сообщение аудио', meaning: 'Голосовое сообщение в мессенджере. Иногда употребляется как просьба записать аудио.', reply: '«Тебе удобнее объяснить голосом, чем писать?»' },
  { term: 'Спойлер', category: 'Медиа', keys: 'spoiler сюжет раскрытие концовка фильм сериал игра', meaning: 'Информация, которая раскрывает важный сюжетный поворот или концовку фильма, сериала, книги или игры.', reply: '«Ты уже посмотрел(а) это? Не буду раскрывать детали, если ещё нет».' },
  { term: 'Мем', category: 'Интернет-культура', keys: 'meme шутка картинка видео интернет культура', meaning: 'Идея, картинка, фраза или видео, которые повторяют и изменяют, передавая шутку или узнаваемую ситуацию.', reply: '«Объясни, что здесь смешного — хочу понять отсылку».' },
  { term: 'Кек', category: 'Юмор', keys: 'kek смех ирония прикол', meaning: 'Сетевое выражение смеха или ироничной реакции. В разных сообществах тон может отличаться.', reply: '«Это доброжелательная шутка или сарказм?»' },
  { term: 'Кэнселить', category: 'Интернет-культура', keys: 'cancel культура отмены бойкот осуждение', meaning: 'Публично осуждать человека или бренд и призывать перестать его поддерживать из-за спорного поступка. Онлайн-реакция может быть несоразмерной или основанной на неполной информации.', reply: '«Что подтверждено фактами, а что пока только пересказывают?»' },
  { term: 'Шеймить', category: 'Общение', keys: 'shame стыдить высмеивать унижать', meaning: 'Стыдить или унижать человека за внешний вид, ошибку, интересы либо выбор.', reply: '«Можно обсудить поступок, не унижая самого человека».' },
  { term: 'Кликбейт', category: 'Медиа', keys: 'clickbait заголовок обман просмотры внимание', meaning: 'Заголовок или изображение, специально сделанные для клика, иногда с преувеличением или искажением содержания.', reply: '«Давай посмотрим, подтверждает ли сам материал обещание заголовка».' },
  { term: 'Думскроллинг', category: 'Цифровые привычки', keys: 'doomscrolling новости тревога лента телефон бесконечно', meaning: 'Привычка долго листать поток преимущественно тревожных новостей или публикаций, даже когда это усиливает беспокойство.', reply: '«Замечаешь, как меняется настроение после ленты? Может, попробуем ограничить время?»' },
  { term: 'Скам', category: 'Безопасность', keys: 'scam мошенничество обман фишинг деньги интернет', meaning: 'Обман с целью получить деньги, личные данные или доступ к аккаунтам. Подозрительные ссылки, обещания лёгкого заработка и просьбы назвать коды требуют осторожности.', reply: '«Не будем торопиться. Проверим отправителя и ссылку, не передавая коды и пароли».' },
  { term: 'Фишинг', category: 'Безопасность', keys: 'phishing пароль данные карта поддельный сайт мошенники', meaning: 'Попытка выманить пароли, коды или платёжные данные через поддельные сайты, письма и сообщения.', reply: '«Настоящая служба не должна просить пересылать одноразовый код в чате. Проверим через официальный канал».' },
  { term: 'Ливнуть', category: 'Игры и общение', keys: 'leave выйти уйти выйти из игры покинуть', meaning: 'Выйти из игры, чата или ситуации. В разговоре может означать желание прекратить участие.', reply: '«Ты хочешь закончить разговор или тебе нужно ненадолго отвлечься?»' },
  { term: 'Апнуть', category: 'Игры', keys: 'up повысить уровень поднять рейтинг увеличить', meaning: 'Повысить уровень, рейтинг или показатель; слово часто используется в играх и цифровых сервисах.', reply: '«Ты хочешь поднять уровень или рейтинг? Какого результата добиваешься?»' },
  { term: 'Имхо', category: 'Переписка', keys: 'имхо imho мнение точка зрения', meaning: 'Разговорная форма написания IMHO: «по моему мнению». Обычно вводит субъективную оценку.', reply: '«Спасибо, что поделился(лась). Какие причины повлияли на твоё мнение?»' },
  { term: 'Триггер', category: 'Эмоции', keys: 'trigger раздражитель напоминание сильная реакция', meaning: 'Событие, слово или ситуация, которые вызывают сильную эмоциональную реакцию. В обычном разговоре это не обязательно означает клиническую травматическую реакцию.', reply: '«Что в этой ситуации оказалось особенно болезненным или неприятным?»' },
  { term: 'Выгорание', category: 'Самочувствие', keys: 'усталость истощение мотивация учёба работа burnout', meaning: 'Состояние длительного истощения, которое может возникать при продолжительной нагрузке и недостаточном восстановлении. Это не просто один уставший день.', reply: '«Какая нагрузка сейчас больше всего забирает силы и что можно временно облегчить?»' },
  { term: 'Быть в ресурсе', category: 'Самочувствие', keys: 'энергия силы настроение отдых восстановление', meaning: 'Разговорное выражение о наличии сил и эмоциональных возможностей справляться с делами и общением.', reply: '«Что помогает тебе восстановиться, когда сил мало?»' },
  { term: 'Личные границы', category: 'Отношения', keys: 'приватность уважение согласие пространство независимость', meaning: 'Понимание того, что для человека приемлемо в общении, прикосновениях, личной информации и времени. Границы помогают договариваться, а не изолироваться.', reply: '«Что для тебя важно, чтобы я спрашивал(а) заранее или не делал(а) без согласия?»' },
  { term: 'Эмоциональные качели', category: 'Эмоции', keys: 'перепады настроения нестабильность чувства', meaning: 'Разговорное описание заметных колебаний эмоций или отношений. По одному выражению нельзя определить причину или поставить диагноз.', reply: '«Я замечаю, что тебе то легче, то тяжелее. Есть ли что-то, что влияет на эти перемены?»' },
  { term: 'Социальное сравнение', category: 'Самочувствие', keys: 'сравнивать себя другие соцсети самооценка внешность успех', meaning: 'Привычка оценивать себя через сравнение с окружающими. Соцсети часто показывают отобранные моменты жизни, а не полную картину.', reply: '«Как ты чувствуешь себя после просмотра этих публикаций? Какие собственные цели для тебя важнее?»' },
  { term: 'Овершеринг', category: 'Интернет-культура', keys: 'oversharing слишком личное раскрытие личные данные соцсети', meaning: 'Публикация или пересказ слишком большого объёма личной информации, иногда без учёта аудитории и последствий.', reply: '«Комфортно ли тебе, что это смогут увидеть незнакомые люди и сохранить публикацию?»' },
  { term: 'Кибербуллинг', category: 'Безопасность', keys: 'травля интернет сообщения оскорбления преследование', meaning: 'Травля с использованием чатов, соцсетей, игр и других цифровых сервисов: оскорбления, угрозы, распространение унизительных материалов.', reply: '«Сохрани доказательства, заблокируй нарушителя и обратись к взрослому, которому доверяешь. Тебе не нужно решать это одному(одной)».' },
  { term: 'Флексить достижениями', category: 'Общение', keys: 'успех похвала хвастаться достижения уверенность', meaning: 'Демонстрировать успехи или достижения. Иногда это безобидная гордость, но при сравнении с другими может восприниматься как хвастовство.', reply: '«Поздравляю! Какой этап оказался самым сложным?»' },
  { term: 'На чилле', category: 'Настроение', keys: 'спокойно отдых расслабление без стресса', meaning: 'Находиться в расслабленном состоянии, не спешить и не переживать из-за мелочей.', reply: '«Похоже, сейчас хочется спокойствия. Что поможет по-настоящему отдохнуть?»' },
  { term: 'Вкатиться', category: 'Учёба и интересы', keys: 'начать изучать освоить тема новое увлечение', meaning: 'Начать разбираться в новой теме, игре, хобби или сообществе.', reply: '«Что тебе интересно попробовать и с чего было бы удобно начать?»' },
  { term: 'Кринжово', category: 'Сленг', keys: 'неловко стыдно неприятно странно cringe', meaning: 'Неловко, странно или смущающе — описание впечатления, а не объективная оценка человека.', reply: '«Тебе некомфортно из-за самого поступка или из-за реакции других?»' },
  { term: 'Сейвить', category: 'Игры и интернет', keys: 'save сохранить спасти сохранить прогресс', meaning: 'Сохранить файл, прогресс или важную информацию; в играх — сохранить прохождение.', reply: '«Хорошая идея — сохранить результат, чтобы ничего не потерять».' },
  { term: 'Пруф', category: 'Интернет-культура', keys: 'proof доказательство источник факт подтверждение', meaning: 'Подтверждение или доказательство утверждения: ссылка на источник, документ, скриншот или другой проверяемый материал.', reply: '«Давай проверим первоисточник, прежде чем делать вывод».' },
  { term: 'Рил / рилс', category: 'Соцсети', keys: 'reel ролик короткое видео instagram', meaning: 'Короткий вертикальный видеоролик; «рил» также могут использовать как вариант английского really — «правда, реально», в зависимости от контекста.', reply: '«Ты про короткое видео или имеешь в виду “реально”?»' },
  { term: 'Ок, понял', category: 'Общение', keys: 'подтверждение слушать согласие уважение', meaning: 'Короткая фраза, которая может показывать, что собеседник услышан. Но сама по себе она не всегда означает полное согласие.', reply: '«Я услышал(а) тебя. Правильно ли я понял(а), что ты имеешь в виду…?»' },
  { term: 'Игнор', category: 'Общение', keys: 'игнорировать молчание не отвечать избегать', meaning: 'Не отвечать или не замечать сообщения и обращения. Причины могут быть разными: занятость, потребность в паузе или намеренное избегание.', reply: '«Я заметил(а), что мы не поговорили. Тебе нужно время или мы можем обсудить это позже?»' },
  { term: 'Откатиться', category: 'Игры и привычки', keys: 'вернуться старый уровень прогресс reset', meaning: 'Вернуться к предыдущему состоянию, потерять часть прогресса или повторить более ранний этап.', reply: '«Такое бывает. Что можно сделать по-другому в следующий раз?»' },
  { term: 'Респект', category: 'Оценка', keys: 'respect уважение признание похвала', meaning: 'Выражение уважения, признания или одобрения поступка.', reply: '«Спасибо за признание. Что именно тебе показалось достойным уважения?»' },
  { term: 'Норм вайб', category: 'Настроение', keys: 'хорошо атмосфера приятно комфортно', meaning: 'Разговорный способ сказать, что атмосфера или впечатление приятное и комфортное.', reply: '«Что создаёт это ощущение — люди, музыка или само место?»' }
];

function normalizeText(value) {
  return String(value || '').toLocaleLowerCase('ru').replaceAll('ё', 'е').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function setFormStatus(element, message, state = '') {
  if (!element) return;
  element.textContent = message;
  if (state) element.dataset.state = state;
  else delete element.dataset.state;
}

function makeElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderGlossary() {
  const container = document.getElementById('cards-dict');
  if (!container) return;
  const fragment = document.createDocumentFragment();
  GLOSSARY.forEach((item) => {
    const card = makeElement('article', 'entry');
    card.dataset.text = `${item.term} ${item.category} ${item.keys} ${item.meaning} ${item.reply}`;
    const top = makeElement('div', 'entry__top');
    top.append(makeElement('div', 'entry__term', item.term), makeElement('div', 'badge', item.category));
    const meaning = makeElement('div', 'entry__mean', item.meaning);
    const how = makeElement('div', 'entry__how');
    const label = makeElement('b', '', 'Как можно ответить: ');
    how.append(label, document.createTextNode(item.reply));
    card.append(top, meaning, how);
    fragment.append(card);
  });
  container.replaceChildren(fragment);
}

function setupTabsAndSearch() {
  const tabs = [...document.querySelectorAll('.tab[data-tab]')];
  const search = document.getElementById('search');
  if (!tabs.length) return;
  const sections = { dict: document.getElementById('tab-dict'), tips: document.getElementById('tab-tips'), psych: document.getElementById('tab-psych') };
  const status = document.getElementById('searchStatus');
  let active = 'dict';

  function applySearch() {
    const section = sections[active];
    if (!section) return;
    const query = normalizeText(search?.value || '');
    const tokens = query.split(/\s+/).filter(Boolean);
    const items = [...section.querySelectorAll('.entry, .tipcard, .pro')];
    let shown = 0;
    items.forEach((item) => {
      const haystack = normalizeText(`${item.dataset.text || ''} ${item.textContent || ''}`);
      const matches = tokens.every((token) => haystack.includes(token));
      item.hidden = !matches;
      item.style.display = matches ? '' : 'none';
      if (matches) shown += 1;
    });
    const empty = document.getElementById(`empty-${active}`);
    if (empty) empty.hidden = !query || shown > 0;
    if (status) status.textContent = query ? `Найдено: ${shown}` : `Элементов в разделе: ${items.length}`;
  }

  function show(name) {
    if (!sections[name]) return;
    active = name;
    tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === name;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-pressed', String(isActive));
    });
    Object.entries(sections).forEach(([key, section]) => section?.classList.toggle('is-show', key === name));
    applySearch();
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.tab)));
  search?.addEventListener('input', applySearch);
  const hash = (window.location.hash || '').slice(1);
  const hashTab = hash === 'psych' ? 'psych' : (hash === 'tips' ? 'tips' : 'dict');
  show(hashTab);
  window.addEventListener('hashchange', () => {
    const target = window.location.hash.slice(1);
    if (target === 'psych') show('psych');
    else if (target === 'tips') show('tips');
    else if (target === 'dictionary') show('dict');
  });

  // Details and intake form for consultation enquiries.
  const modal = document.getElementById('psychModal');
  const form = document.getElementById('psychForm');
  if (!modal || !form) return;
  const closeButton = document.getElementById('modalClose');
  const closeModal = () => {
    modal.classList.remove('is-active');
    modal.setAttribute('aria-hidden', 'true');
  };
  const openModal = (action, specialty) => {
    const title = document.getElementById('modalTitle');
    const desc = document.getElementById('modalDesc');
    document.getElementById('psychSpecialty').value = specialty;
    document.getElementById('psychPurpose').value = action;
    title.textContent = action === 'message' ? 'Написать координатору' : 'Заявка на консультацию';
    const submitButton = document.getElementById('modalSubmit');
    submitButton.disabled = false;
    submitButton.textContent = 'Отправить заявку';
    desc.textContent = action === 'details'
      ? `Темы: трудности общения, личные границы, стресс, доверие и эмоциональная поддержка. Укажите контакты, если хотите запросить подбор специалиста по направлению «${specialty}».`
      : `Направление: ${specialty}. Заявка будет сохранена в системе проекта. Это ещё не подтверждённая запись к конкретному психологу.`;
    setFormStatus(document.getElementById('psychStatus'), '');
    modal.classList.add('is-active');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('clientName').focus();
  };
  document.getElementById('tab-psych')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-contact-action]');
    if (!button) return;
    openModal(button.dataset.contactAction, button.dataset.specialty || 'Психологическая поддержка');
  });
  closeButton?.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.classList.contains('is-active')) closeModal(); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('modalSubmit');
    const statusEl = document.getElementById('psychStatus');
    if (document.getElementById('psychWebsite').value) return;
    const body = {
      name: document.getElementById('clientName').value.trim(),
      contact: document.getElementById('clientContact').value.trim(),
      note: document.getElementById('clientNote').value.trim(),
      specialty: document.getElementById('psychSpecialty').value,
      purpose: document.getElementById('psychPurpose').value
    };
    if (!body.name || !body.contact) {
      setFormStatus(statusEl, 'Укажите имя и способ связи.', 'error');
      return;
    }
    submit.disabled = true;
    setFormStatus(statusEl, 'Отправляем заявку на сервер…');
    try {
      const response = await fetch('/api/psych-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, website: '' })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось сохранить заявку. Попробуйте ещё раз.');
      setFormStatus(statusEl, result.message || 'Заявка сохранена.', 'ok');
      form.reset();
      document.getElementById('psychSpecialty').value = body.specialty;
      document.getElementById('psychPurpose').value = body.purpose;
      submit.textContent = 'Заявка отправлена';
      submit.disabled = true;
      // Keep the confirmation visible instead of pretending that a psychologist has already replied.
    } catch (error) {
      setFormStatus(statusEl, `${error.message} Убедитесь, что сайт запущен через сервер.`, 'error');
    } finally {
      if (!statusEl.dataset.state || statusEl.dataset.state !== 'ok') submit.disabled = false;
    }
  });
}

function setupReviews() {
  const list = document.getElementById('reviewsContainer');
  const form = document.getElementById('reviewForm');
  if (!list || !form) return;
  const empty = document.getElementById('reviewsEmpty');
  const status = document.getElementById('reviewStatus');
  const submit = document.getElementById('reviewSubmit');

  function renderReviews(reviews) {
    list.replaceChildren();
    reviews.forEach((review) => {
      const card = makeElement('article', 'review-card');
      const header = makeElement('div', 'review-header');
      const author = makeElement('div', 'review-author', review.name);
      const stars = makeElement('div', 'review-stars', `${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}`);
      stars.setAttribute('aria-label', `Оценка: ${review.rating} из 5`);
      const content = makeElement('div', 'review-text', review.text);
      const date = review.createdAt ? new Date(review.createdAt) : null;
      const dateText = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
      header.append(author, stars);
      card.append(header, content);
      if (dateText) card.append(makeElement('div', 'review-date', dateText));
      list.append(card);
    });
    empty.hidden = reviews.length > 0;
    if (!reviews.length) empty.textContent = 'Пока отзывов нет. Вы можете оставить первый отзыв.';
  }

  async function loadReviews() {
    try {
      const response = await fetch('/api/reviews');
      if (!response.ok) throw new Error('Не удалось загрузить отзывы.');
      const data = await response.json();
      renderReviews(Array.isArray(data.reviews) ? data.reviews : []);
    } catch {
      empty.hidden = false;
      empty.textContent = 'Отзывы временно недоступны. Проверьте подключение к серверу сайта.';
    }
  }
  loadReviews();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (document.getElementById('revWebsite').value) return;
    const payload = {
      name: document.getElementById('revName').value.trim(),
      rating: Number(document.getElementById('revRating').value),
      text: document.getElementById('revText').value.trim(),
      website: ''
    };
    submit.disabled = true;
    setFormStatus(status, 'Сохраняем отзыв…');
    try {
      const response = await fetch('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось сохранить отзыв.');
      form.reset();
      document.getElementById('revRating').value = '5';
      setFormStatus(status, 'Спасибо! Отзыв сохранён и опубликован.', 'ok');
      await loadReviews();
    } catch (error) {
      setFormStatus(status, `${error.message} Убедитесь, что сайт запущен через сервер.`, 'error');
    } finally {
      submit.disabled = false;
    }
  });
}

function setupAIChat() {
  const form = document.getElementById('aiForm');
  const input = document.getElementById('aiInput');
  const chat = document.getElementById('aiChat');
  const send = document.getElementById('aiSend');
  const status = document.getElementById('aiServiceStatus');
  if (!form || !input || !chat || !send) return;
  const history = [];

  const addBubble = (className, text) => {
    const bubble = makeElement('div', `bubble ${className}`, text);
    chat.append(bubble);
    chat.scrollTop = chat.scrollHeight;
    return bubble;
  };

  async function checkService() {
    try {
      const response = await fetch('/api/health');
      const result = await response.json();
      if (result.aiConfigured) {
        status.textContent = 'ИИ-помощник подключён. Сообщения обрабатываются через серверный API.';
        status.dataset.state = 'ok';
      } else {
        status.textContent = 'Для работы ИИ администратору нужно указать OPENAI_API_KEY в настройках сервера.';
        status.dataset.state = 'error';
      }
    } catch {
      status.textContent = 'Сервер сайта недоступен. Запустите проект командой npm start и откройте адрес, который покажет сервер.';
      status.dataset.state = 'error';
    }
  }
  checkService();

  async function sendMessage(value) {
    const message = String(value || '').trim();
    if (!message || send.disabled) return;
    addBubble('bubble--parent', message);
    input.value = '';
    const inputHistory = [...history, { role: 'user', content: message }].slice(-12);
    send.disabled = true;
    input.disabled = true;
    const waiting = addBubble('bubble--system', 'Формирую ответ…');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: inputHistory })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось получить ответ от ИИ.');
      waiting.remove();
      addBubble('bubble--ai', result.reply);
      history.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
      if (history.length > 12) history.splice(0, history.length - 12);
    } catch (error) {
      waiting.remove();
      addBubble('bubble--system', `${error.message} Проверьте подключение сервера и настройку API-ключа.`);
    } finally {
      send.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });
  document.querySelectorAll('.prompt-chip[data-prompt]').forEach((chip) => chip.addEventListener('click', () => {
    input.value = chip.dataset.prompt || '';
    input.focus();
  }));
}

document.addEventListener('DOMContentLoaded', () => {
  renderGlossary();
  setupTabsAndSearch();
  setupReviews();
  setupAIChat();
});
