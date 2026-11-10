// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Vinicius Bispo

// tests/test-hiragana.js — testa hiragana.js sem precisar do GNOME Shell.
//
// Como rodar (de dentro da pasta da extensão):
//     gjs -m tests/test-hiragana.js
//
// POR QUE AS TABELAS ESTÃO ESCRITAS À MÃO?
// Se o teste calculasse o resultado esperado com a mesma regra do código,
// um erro na regra apareceria nos dois lados e o teste passaria mesmo assim.
// Uma tabela literal é uma "segunda opinião" independente: cada linha foi
// escrita pensando na leitura correta, não no algoritmo.

// `-m` faz o gjs tratar este arquivo como ES Module; por isso funciona o
// import relativo abaixo (resolvido a partir da pasta deste arquivo).
import * as H from '../hiragana.js';

// 'system' é um módulo embutido do GJS; usamos só para devolver código de
// saída ≠ 0 em caso de falha (útil se um dia você rodar isto num CI).
import System from 'system';

let passed = 0;
let failed = 0;

function check(description, actual, expected) {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        print(`✗ ${description}: esperado «${expected}», obtido «${actual}»`);
    }
}

// --- Dias do mês: 1 a 31 ---------------------------------------------------
const EXPECTED_DAYS = {
    1: 'ついたち', 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか',
    6: 'むいか', 7: 'なのか', 8: 'ようか', 9: 'ここのか', 10: 'とおか',
    11: 'じゅういちにち', 12: 'じゅうににち', 13: 'じゅうさんにち',
    14: 'じゅうよっか', 15: 'じゅうごにち', 16: 'じゅうろくにち',
    17: 'じゅうしちにち', 18: 'じゅうはちにち', 19: 'じゅうくにち',
    20: 'はつか',
    21: 'にじゅういちにち', 22: 'にじゅうににち', 23: 'にじゅうさんにち',
    24: 'にじゅうよっか', 25: 'にじゅうごにち', 26: 'にじゅうろくにち',
    27: 'にじゅうしちにち', 28: 'にじゅうはちにち', 29: 'にじゅうくにち',
    30: 'さんじゅうにち', 31: 'さんじゅういちにち',
};
for (let d = 1; d <= 31; d++)
    check(`dia ${d}`, H.dayToHiragana(d), EXPECTED_DAYS[d]);

// --- Horas: 0 a 23 (24h) ---------------------------------------------------
const EXPECTED_HOURS = [
    'れいじ', 'いちじ', 'にじ', 'さんじ', 'よじ', 'ごじ',
    'ろくじ', 'しちじ', 'はちじ', 'くじ', 'じゅうじ', 'じゅういちじ',
    'じゅうにじ', 'じゅうさんじ', 'じゅうよじ', 'じゅうごじ', 'じゅうろくじ', 'じゅうしちじ',
    'じゅうはちじ', 'じゅうくじ', 'にじゅうじ', 'にじゅういちじ', 'にじゅうにじ', 'にじゅうさんじ',
];
for (let h = 0; h <= 23; h++)
    check(`hora ${h}`, H.hourToHiragana(h), EXPECTED_HOURS[h]);

// --- Horas no formato 12h (amostras nas bordas) ----------------------------
check('12h 0:00', H.hourToHiragana(0, {use12h: true}), 'ごぜん れいじ');
check('12h 9:00', H.hourToHiragana(9, {use12h: true}), 'ごぜん くじ');
check('12h 11:00', H.hourToHiragana(11, {use12h: true}), 'ごぜん じゅういちじ');
check('12h 12:00', H.hourToHiragana(12, {use12h: true}), 'ごご れいじ');
check('12h 16:00', H.hourToHiragana(16, {use12h: true}), 'ごご よじ');
check('12h 23:00', H.hourToHiragana(23, {use12h: true}), 'ごご じゅういちじ');

// --- Minutos: 0 a 59 -------------------------------------------------------
const EXPECTED_MINUTES = [
    '', // 0: não aparece por padrão
    'いっぷん', 'にふん', 'さんぷん', 'よんぷん', 'ごふん',
    'ろっぷん', 'ななふん', 'はっぷん', 'きゅうふん', 'じゅっぷん',
    'じゅういっぷん', 'じゅうにふん', 'じゅうさんぷん', 'じゅうよんぷん', 'じゅうごふん',
    'じゅうろっぷん', 'じゅうななふん', 'じゅうはっぷん', 'じゅうきゅうふん', 'にじゅっぷん',
    'にじゅういっぷん', 'にじゅうにふん', 'にじゅうさんぷん', 'にじゅうよんぷん', 'にじゅうごふん',
    'にじゅうろっぷん', 'にじゅうななふん', 'にじゅうはっぷん', 'にじゅうきゅうふん', 'さんじゅっぷん',
    'さんじゅういっぷん', 'さんじゅうにふん', 'さんじゅうさんぷん', 'さんじゅうよんぷん', 'さんじゅうごふん',
    'さんじゅうろっぷん', 'さんじゅうななふん', 'さんじゅうはっぷん', 'さんじゅうきゅうふん', 'よんじゅっぷん',
    'よんじゅういっぷん', 'よんじゅうにふん', 'よんじゅうさんぷん', 'よんじゅうよんぷん', 'よんじゅうごふん',
    'よんじゅうろっぷん', 'よんじゅうななふん', 'よんじゅうはっぷん', 'よんじゅうきゅうふん', 'ごじゅっぷん',
    'ごじゅういっぷん', 'ごじゅうにふん', 'ごじゅうさんぷん', 'ごじゅうよんぷん', 'ごじゅうごふん',
    'ごじゅうろっぷん', 'ごじゅうななふん', 'ごじゅうはっぷん', 'ごじゅうきゅうふん',
];
for (let m = 0; m <= 59; m++)
    check(`minuto ${m}`, H.minuteToHiragana(m), EXPECTED_MINUTES[m]);
check('minuto 0 com ちょうど', H.minuteToHiragana(0, {showChoudo: true}), 'ちょうど');

// --- Meses e dias da semana ------------------------------------------------
const EXPECTED_MONTHS = [
    null, 'いちがつ', 'にがつ', 'さんがつ', 'しがつ', 'ごがつ', 'ろくがつ',
    'しちがつ', 'はちがつ', 'くがつ', 'じゅうがつ', 'じゅういちがつ', 'じゅうにがつ',
];
for (let mo = 1; mo <= 12; mo++)
    check(`mês ${mo}`, H.monthToHiragana(mo), EXPECTED_MONTHS[mo]);

const EXPECTED_WEEKDAYS = [
    'にちようび', 'げつようび', 'かようび', 'すいようび',
    'もくようび', 'きんようび', 'どようび',
];
for (let w = 0; w <= 6; w++)
    check(`dia da semana ${w}`, H.weekdayToHiragana(w), EXPECTED_WEEKDAYS[w]);

// --- Kanji -----------------------------------------------------------------
check('kanji 1', H.numberToKanji(1), '一');
check('kanji 10', H.numberToKanji(10), '十');
check('kanji 11', H.numberToKanji(11), '十一');
check('kanji 20', H.numberToKanji(20), '二十');
check('kanji 31', H.numberToKanji(31), '三十一');

// --- Frases completas (o exemplo do enunciado: terça, 10/11, 14:20) --------
const sample = {month: 11, day: 10, weekday: 2, hour: 14, minute: 20};
check('frase hiragana', H.formatHiragana(sample),
    'じゅういちがつ とおか かようび ・ じゅうよじ にじゅっぷん');
check('frase kanji', H.formatKanji(sample), '十一月十日 火曜日');
check('frase português', H.formatPortuguese(sample), 'terça-feira, 10 de novembro');
check('dia e mês curto', H.formatDayMonthPortuguese(sample), '10 novembro');
check('dia e mês curto (abril)', H.formatDayMonthPortuguese({month: 4, day: 7}), '7 abril');

// Opções de exibição: só a hora, hora cheia sem ちょうど (não pode sobrar espaço).
check('só hora, hora cheia',
    H.formatHiragana({...sample, minute: 0}, {showDate: false, showWeekday: false}),
    'じゅうよじ');
check('só data',
    H.formatHiragana(sample, {showTime: false}),
    'じゅういちがつ とおか かようび');
check('nada ligado', H.formatHiragana(sample,
    {showDate: false, showWeekday: false, showTime: false}), '');

// --- Valores inválidos devem lançar RangeError -----------------------------
for (const [label, fn] of [
    ['dia 0', () => H.dayToHiragana(0)],
    ['dia 32', () => H.dayToHiragana(32)],
    ['hora 24', () => H.hourToHiragana(24)],
    ['minuto 60', () => H.minuteToHiragana(60)],
    ['mês 13', () => H.monthToHiragana(13)],
    ['dia 1.5', () => H.dayToHiragana(1.5)],
]) {
    let threw = false;
    try {
        fn();
    } catch (e) {
        threw = e instanceof RangeError;
    }
    check(`${label} lança RangeError`, threw, true);
}

// --- Resumo ----------------------------------------------------------------
print(`\n${passed} passaram, ${failed} falharam`);
if (failed > 0)
    System.exit(1);
