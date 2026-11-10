// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Vinicius Bispo

// hiragana.js — conversão de datas e horas para hiragana, kanji e português.
//
// POR QUE UM MÓDULO SEPARADO?
// Este arquivo NÃO importa nada do GNOME (nem St, nem GLib, nem Main).
// São só funções puras: recebem números e devolvem strings, sem efeitos
// colaterais. Isso traz duas vantagens:
//   1. dá para testar no terminal com `gjs -m tests/test-hiragana.js`,
//      sem precisar recarregar o GNOME Shell (que no Wayland exige logout);
//   2. a lógica difícil (as leituras irregulares do japonês) fica isolada
//      da lógica de interface, e cada parte pode ser entendida sozinha.
//
// CONVENÇÃO DE ENTRADA (igual à do objeto Date do JavaScript):
//   weekday: 0 = domingo … 6 = sábado (Date.getDay())
//   month:   1 … 12  (atenção: Date.getMonth() vai de 0 a 11, GLib vai de 1 a 12;
//                     escolhi 1–12 porque é como as pessoas pensam o mês)
//   day:     1 … 31
//   hour:    0 … 23
//   minute:  0 … 59

// ---------------------------------------------------------------------------
// Tabelas básicas
// ---------------------------------------------------------------------------

// Dias da semana na ordem de Date.getDay(). O sufixo ようび (曜日) significa
// "dia da semana"; a primeira parte é o "elemento" do dia (sol, lua, fogo…).
export const WEEKDAYS = [
    'にちようび', // domingo  (日 sol)
    'げつようび', // segunda  (月 lua)
    'かようび',   // terça    (火 fogo)
    'すいようび', // quarta   (水 água)
    'もくようび', // quinta   (木 madeira)
    'きんようび', // sexta    (金 metal/ouro)
    'どようび',   // sábado   (土 terra)
];

// Meses: número + がつ (月). Abril, julho e setembro usam leituras
// especiais: し (não よん), しち (não なな) e く (não きゅう).
// Índice 0 vazio para que MONTHS[1] seja janeiro e não haja "-1" espalhado
// pelo código.
export const MONTHS = [
    '',
    'いちがつ',
    'にがつ',
    'さんがつ',
    'しがつ',       // 4: し, não よん
    'ごがつ',
    'ろくがつ',
    'しちがつ',     // 7: しち, não なな
    'はちがつ',
    'くがつ',       // 9: く, não きゅう
    'じゅうがつ',
    'じゅういちがつ',
    'じゅうにがつ',
];

// Prefixos de dezena. Repare que 40 é よんじゅう (e não しじゅう) no uso moderno.
// O índice é a dezena: TENS[2] = 'にじゅう' (20).
const TENS = ['', 'じゅう', 'にじゅう', 'さんじゅう', 'よんじゅう', 'ごじゅう'];

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

// Lança RangeError se o valor não for um inteiro dentro do intervalo.
// Por quê? Uma função pura que recebe 32 como dia e devolve lixo esconde
// bugs; falhar alto e cedo é mais fácil de depurar.
function assertRange(name, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max)
        throw new RangeError(`${name} fora do intervalo ${min}–${max}: ${value}`);
}

// ---------------------------------------------------------------------------
// Dia da semana e mês
// ---------------------------------------------------------------------------

export function weekdayToHiragana(weekday) {
    assertRange('weekday', weekday, 0, 6);
    return WEEKDAYS[weekday];
}

export function monthToHiragana(month) {
    assertRange('month', month, 1, 12);
    return MONTHS[month];
}

// ---------------------------------------------------------------------------
// Dias do mês — onde mora a maior parte das irregularidades
// ---------------------------------------------------------------------------

// De 1 a 10 os dias usam a contagem nativa japonesa (ひ・ふ・み…), não a
// contagem sino-japonesa (いち・に・さん…). Por isso não existe regra: é
// uma tabela que precisa ser decorada.
const FIRST_TEN_DAYS = [
    '',
    'ついたち',   // 1
    'ふつか',     // 2
    'みっか',     // 3
    'よっか',     // 4
    'いつか',     // 5
    'むいか',     // 6
    'なのか',     // 7
    'ようか',     // 8
    'ここのか',   // 9
    'とおか',     // 10
];

// Unidade + にち para os dias de 11 em diante. Três posições fogem da regra:
//   4 → よっか (nunca よんにち): 14 じゅうよっか, 24 にじゅうよっか;
//   7 → しちにち (não ななにち): 17, 27;
//   9 → くにち  (não きゅうにち): 19, 29.
// O índice 0 fica vazio porque 20 e 30 são tratados à parte.
const DAY_UNITS = [
    '',
    'いちにち',
    'ににち',
    'さんにち',
    'よっか',     // exceção
    'ごにち',
    'ろくにち',
    'しちにち',   // exceção
    'はちにち',
    'くにち',     // exceção
];

export function dayToHiragana(day) {
    assertRange('day', day, 1, 31);

    if (day <= 10)
        return FIRST_TEN_DAYS[day];

    // 20 é totalmente irregular: はつか (de 二十日, leitura nativa).
    if (day === 20)
        return 'はつか';

    const tens = Math.floor(day / 10);
    const unit = day % 10;

    // 30: dezena + にち (さんじゅうにち). Com 20 já tratado, sobra só ele.
    if (unit === 0)
        return `${TENS[tens]}にち`;

    // 11–19, 21–29, 31: dezena + unidade (já com にち ou よっか).
    return TENS[tens] + DAY_UNITS[unit];
}

// ---------------------------------------------------------------------------
// Horas
// ---------------------------------------------------------------------------

// Unidade + じ (時). Mesmas exceções dos meses, com um detalhe: 4 é よ
// (não し nem よん) → よじ, じゅうよじ.
const HOUR_UNITS = ['', 'いち', 'に', 'さん', 'よ', 'ご', 'ろく', 'しち', 'はち', 'く'];

// Converte só o número da hora (0–23) para hiragana, sem ごぜん/ごご.
// Separada de hourToHiragana para ser reaproveitada no formato 12h.
function hourNumber(hour) {
    if (hour === 0)
        return 'れいじ'; // 零時: "hora zero"

    const tens = Math.floor(hour / 10);
    const unit = hour % 10;
    // 10 e 20: TENS dá じゅう/にじゅう e HOUR_UNITS[0] é '' → じゅうじ, にじゅうじ.
    return `${TENS[tens]}${HOUR_UNITS[unit]}じ`;
}

// options.use12h: se verdadeiro, usa ごぜん (午前, manhã) / ごご (午後, tarde).
//
// Convenção escolhida para o 12h: 0:00–11:59 = ごぜん 0–11, 12:00–23:59 = ごご 0–11.
// Ou seja, meio-dia vira ごご れいじ. No Japão também se vê ごぜん じゅうにじ
// ou ごご じゅうにじ para o meio-dia; 0–11 é a forma menos ambígua, porque
// cada hora tem um único nome. Se preferir outra convenção, mude aqui.
export function hourToHiragana(hour, {use12h = false} = {}) {
    assertRange('hour', hour, 0, 23);

    if (!use12h)
        return hourNumber(hour);

    const period = hour < 12 ? 'ごぜん' : 'ごご';
    return `${period} ${hourNumber(hour % 12)}`;
}

// ---------------------------------------------------------------------------
// Minutos — a leitura muda conforme o som (ふん / ぷん / っぷん)
// ---------------------------------------------------------------------------

// Unidade + ふん/ぷん. O 分 (fun) sofre "rendaku/handakuten" depois de
// certos números: 1, 3, 4, 6, 8 e 10 viram ぷん, e 1, 6, 8 e 10 ainda
// geminam a consoante (いっ, ろっ, はっ, じゅっ).
const MINUTE_UNITS = [
    '',
    'いっぷん',
    'にふん',
    'さんぷん',
    'よんぷん',
    'ごふん',
    'ろっぷん',
    'ななふん',
    'はっぷん',
    'きゅうふん',
];

// Para as dezenas redondas (10, 20…50) a palavra じゅう encurta para
// じゅっ e o 分 vira ぷん: じゅっぷん, にじゅっぷん, さんじゅっぷん…
// (じっぷん também é aceito em textos formais; aqui uso じゅっぷん.)
const ROUND_TENS_PREFIX = ['', '', 'に', 'さん', 'よん', 'ご'];

// options.showChoudo: com 0 minutos, devolve ちょうど ("em ponto") em vez de ''.
export function minuteToHiragana(minute, {showChoudo = false} = {}) {
    assertRange('minute', minute, 0, 59);

    if (minute === 0)
        return showChoudo ? 'ちょうど' : '';

    const tens = Math.floor(minute / 10);
    const unit = minute % 10;

    if (unit === 0)
        return `${ROUND_TENS_PREFIX[tens]}じゅっぷん`;

    // 1–9 e 11–59 não redondos: dezena normal + unidade com ふん/ぷん.
    // Ex.: 24 → にじゅう + よんぷん; 37 → さんじゅう + ななふん.
    return TENS[tens] + MINUTE_UNITS[unit];
}

// ---------------------------------------------------------------------------
// Kanji
// ---------------------------------------------------------------------------

const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const KANJI_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// Numerais kanji tradicionais (não posicionais): 10 = 十, 11 = 十一,
// 20 = 二十, 31 = 三十一. Repare que não se escreve 一十 para 10–19.
// Funciona para 1–99, que é tudo de que precisamos.
export function numberToKanji(n) {
    assertRange('n', n, 1, 99);
    const tens = Math.floor(n / 10);
    const unit = n % 10;
    if (tens === 0)
        return KANJI_DIGITS[unit];
    const tensPart = tens === 1 ? '' : KANJI_DIGITS[tens];
    return `${tensPart}十${KANJI_DIGITS[unit]}`;
}

// ---------------------------------------------------------------------------
// Português (sem depender do locale do sistema, para o resultado ser previsível)
// ---------------------------------------------------------------------------

const PT_WEEKDAYS = [
    'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
    'quinta-feira', 'sexta-feira', 'sábado',
];
const PT_MONTHS = [
    '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// ---------------------------------------------------------------------------
// Formatação das frases completas
// ---------------------------------------------------------------------------
//
// `parts` é um objeto simples {month, day, weekday, hour, minute}. Usar um
// objeto (e não um Date) mantém o módulo independente de fuso horário: quem
// chama decide de onde vem a data (Date, GLib.DateTime, um teste…).

// Ex.: 'じゅういちがつ とおか かようび ・ じゅうよじ にじゅっぷん'
export function formatHiragana(parts, {
    showDate = true,
    showWeekday = true,
    showTime = true,
    use12h = false,
    showChoudo = false,
} = {}) {
    const dateWords = [];
    if (showDate)
        dateWords.push(monthToHiragana(parts.month), dayToHiragana(parts.day));
    if (showWeekday)
        dateWords.push(weekdayToHiragana(parts.weekday));

    const timeWords = [];
    if (showTime) {
        timeWords.push(hourToHiragana(parts.hour, {use12h}));
        // minuteToHiragana pode devolver '' (0 minutos sem ちょうど);
        // o filter(Boolean) abaixo descarta strings vazias para não sobrar
        // espaço duplo.
        timeWords.push(minuteToHiragana(parts.minute, {showChoudo}));
    }

    // Junta cada bloco com espaço e os blocos com ' ・ ' (nakaguro, o
    // ponto do meio usado em japonês como separador).
    return [dateWords, timeWords]
        .map(words => words.filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' ・ ');
}

// Ex.: '十一月十日 火曜日'
export function formatKanji(parts) {
    assertRange('weekday', parts.weekday, 0, 6);
    return `${numberToKanji(parts.month)}月${numberToKanji(parts.day)}日 ` +
        `${KANJI_WEEKDAYS[parts.weekday]}曜日`;
}

// Ex.: '10 novembro' — forma curta usada ao lado do dia da semana no widget.
export function formatDayMonthPortuguese(parts) {
    assertRange('month', parts.month, 1, 12);
    assertRange('day', parts.day, 1, 31);
    return `${parts.day} ${PT_MONTHS[parts.month]}`;
}

// Ex.: 'terça-feira, 10 de novembro'
export function formatPortuguese(parts) {
    assertRange('weekday', parts.weekday, 0, 6);
    assertRange('month', parts.month, 1, 12);
    assertRange('day', parts.day, 1, 31);
    return `${PT_WEEKDAYS[parts.weekday]}, ${parts.day} de ${PT_MONTHS[parts.month]}`;
}
