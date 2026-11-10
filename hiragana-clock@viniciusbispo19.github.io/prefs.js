// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Vinicius Bispo

// prefs.js — janela de preferências.
//
// IMPORTANTE: este arquivo roda num PROCESSO SEPARADO do gnome-shell (o
// org.gnome.Shell.Extensions). Ali existe GTK 4 + libadwaita, mas NÃO existe
// St, Clutter nem Main. Por isso nunca importe nada de ui/ aqui, e nunca
// importe Gtk/Adw no extension.js: cada lado tem o seu mundo.
//
// A única ponte entre os dois processos é o GSettings: a janela grava um
// valor, o dconf avisa o gnome-shell, e extension.js reage no sinal 'changed'.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango'; // descrição de fontes (família, peso, tamanho)

// Caminho diferente do usado em extension.js: .../Shell/Extensions/js/...
// é o recurso do aplicativo de preferências, não do gnome-shell.
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Valores gravados no GSettings (iguais aos <choice> do schema) e os rótulos
// mostrados ao usuário, na MESMA ordem. O índice do ComboRow liga os dois.
const ANCHORS = [
    ['top-left', 'Canto superior esquerdo'],
    ['top-center', 'Centro superior'],
    ['top-right', 'Canto superior direito'],
    ['center-left', 'Centro à esquerda'],
    ['center', 'Centro da tela'],
    ['center-right', 'Centro à direita'],
    ['bottom-left', 'Canto inferior esquerdo'],
    ['bottom-center', 'Centro inferior'],
    ['bottom-right', 'Canto inferior direito'],
    ['custom', 'Livre (onde você arrastou)'],
];

const COLORS = [
    ['silver', 'Prateado (degradê)'],
    ['white', 'Branco'],
    ['black', 'Preto'],
];

export default class HiraganaClockPreferences extends ExtensionPreferences {
    // fillPreferencesWindow recebe uma Adw.PreferencesWindow vazia e nós a
    // preenchemos com páginas → grupos → linhas (rows).
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Guardar o settings na janela amarra a vida dele à da janela. Sem
        // isso o coletor de lixo do JS pode liberá-lo e os bindings param de
        // funcionar sem dar erro nenhum.
        window._settings = settings;

        // Handlers conectados direto no settings (que pode viver mais que a
        // janela). Guardamos os ids e desconectamos todos ao fechar.
        this._settingsHandlerIds = [];
        window.connect('close-request', () => {
            this._settingsHandlerIds.forEach(id => settings.disconnect(id));
            this._settingsHandlerIds = [];
            return false; // false = deixa a janela fechar normalmente
        });

        const page = new Adw.PreferencesPage({
            title: 'Geral',
            icon_name: 'preferences-system-time-symbolic',
        });
        window.add(page);

        // ------------------------------------------------------------------
        // Grupo 1: conteúdo
        // ------------------------------------------------------------------
        const contentGroup = new Adw.PreferencesGroup({
            title: 'Conteúdo',
            description: 'O dia da semana em hiragana é sempre mostrado. ' +
                'Dica: clique com o botão direito no widget para abrir esta janela.',
        });
        page.add(contentGroup);

        contentGroup.add(this._switchRow(settings, 'show-year',
            'Ano', 'Abaixo do dia e mês, ex.: 2025'));
        contentGroup.add(this._switchRow(settings, 'show-kanji',
            'Data em kanji', 'Ex.: 十一月十日 火曜日'));
        contentGroup.add(this._switchRow(settings, 'show-time',
            'Hora em hiragana', 'Ex.: じゅうよじ にじゅっぷん, abaixo do widget'));
        contentGroup.add(this._switchRow(settings, 'use-12h',
            'Formato 12 horas', 'Usa ごぜん (manhã) e ごご (tarde)'));
        contentGroup.add(this._switchRow(settings, 'show-choudo',
            'Mostrar ちょうど na hora cheia', 'Em vez de omitir os minutos quando são 0'));

        // ------------------------------------------------------------------
        // Grupo 2: posição na área de trabalho
        // ------------------------------------------------------------------
        const placeGroup = new Adw.PreferencesGroup({
            title: 'Posição na área de trabalho',
            description: 'O widget fica sobre o papel de parede, abaixo das janelas.',
        });
        page.add(placeGroup);

        placeGroup.add(this._switchRow(settings, 'draggable',
            'Permitir arrastar', 'Arraste o widget com o botão esquerdo do mouse'));
        placeGroup.add(this._choiceRow(settings, 'anchor', 'Posição',
            'Ao arrastar, muda sozinha para "Livre"', ANCHORS));

        const marginRows = [
            this._spinRow(settings, 'margin-x', 0, 2000, 4,
                'Distância horizontal', 'Pixels até a borda esquerda/direita (ignorado no centro)'),
            this._spinRow(settings, 'margin-y', 0, 2000, 4,
                'Distância vertical', 'Pixels até a borda superior/inferior (ignorado no centro)'),
        ];
        marginRows.forEach(row => placeGroup.add(row));

        // Na posição livre as distâncias não valem (quem manda é o arrasto),
        // então acinzentamos essas linhas: "sensitive = false" deixa a linha
        // visível mas desativada, o que explica a opção melhor do que sumir
        // com ela.
        const syncMarginsSensitive = () => {
            const isCustom = settings.get_string('anchor') === 'custom';
            marginRows.forEach(row => (row.sensitive = !isCustom));
        };
        syncMarginsSensitive();
        this._settingsHandlerIds.push(
            settings.connect('changed::anchor', syncMarginsSensitive));

        // ------------------------------------------------------------------
        // Grupo 3: aparência
        // ------------------------------------------------------------------
        const lookGroup = new Adw.PreferencesGroup({title: 'Aparência'});
        page.add(lookGroup);

        lookGroup.add(this._spinRow(settings, 'font-size', 24, 240, 2,
            'Tamanho', 'Do dia da semana, em pontos; o resto acompanha'));
        lookGroup.add(this._fontRow(settings, 'hiragana-font',
            'Fonte do hiragana', 'Padrão: Yuji Syuku (pincel)'));
        lookGroup.add(this._fontRow(settings, 'date-font',
            'Fonte da data', 'Padrão: League Gothic (estreita)'));
        lookGroup.add(this._choiceRow(settings, 'color-style', 'Cor',
            'Prateado como na foto; preto para papéis de parede claros', COLORS));

        // ------------------------------------------------------------------
        // Grupo 4: painel
        // ------------------------------------------------------------------
        const panelGroup = new Adw.PreferencesGroup({title: 'Painel superior'});
        page.add(panelGroup);

        panelGroup.add(this._switchRow(settings, 'hide-default-clock',
            'Esconder o relógio do painel', 'Ele volta ao desativar a extensão'));
    }

    // Adw.SwitchRow (interruptor) ligada a uma chave booleana.
    // settings.bind() sincroniza nos dois sentidos, e o binding morre junto
    // com a linha, então não há nada para desconectar.
    _switchRow(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    // Adw.SpinRow (campo numérico com + e −) ligada a uma chave inteira.
    // Os limites repetem o <range> do schema. O GSettings converte sozinho o
    // inteiro 'i' da chave para o double da propriedade 'value'.
    _spinRow(settings, key, min, max, step, title, subtitle) {
        const row = Adw.SpinRow.new_with_range(min, max, step);
        row.title = title;
        row.subtitle = subtitle;
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    // ComboRow (lista suspensa) para uma chave de texto com <choices>.
    // `choices` é uma lista de pares [valor no GSettings, rótulo na tela].
    // Não dá para usar settings.bind() direto: a chave guarda texto
    // ('center-left') e a linha usa um índice (3). Então sincronizamos à
    // mão, nos dois sentidos. Serve para a posição E para a cor.
    _choiceRow(settings, key, title, subtitle, choices) {
        const row = new Adw.ComboRow({
            title,
            subtitle,
            model: Gtk.StringList.new(choices.map(([, label]) => label)),
        });

        const syncFromSettings = () => {
            const value = settings.get_string(key);
            row.selected = Math.max(choices.findIndex(([v]) => v === value), 0);
        };
        syncFromSettings();

        // Interface → settings.
        row.connect('notify::selected', () => {
            const value = choices[row.selected][0];
            if (value !== settings.get_string(key))
                settings.set_string(key, value);
        });
        // Settings → interface: alguém mudou por fora (gsettings no terminal,
        // ou VOCÊ arrastou o widget com esta janela aberta: a posição vira
        // "Livre" aqui na hora).
        this._settingsHandlerIds.push(
            settings.connect(`changed::${key}`, syncFromSettings));
        return row;
    }

    // Linha com o seletor de fontes do GTK. level FAMILY = o usuário escolhe
    // só a família (o tamanho tem a sua própria opção). Mesmo esquema da
    // âncora: a chave é texto, o botão usa um Pango.FontDescription.
    _fontRow(settings, key, title, subtitle) {
        const button = new Gtk.FontDialogButton({
            dialog: new Gtk.FontDialog({title}),
            level: Gtk.FontLevel.FAMILY,
            use_font: true, // o próprio botão mostra o nome desenhado na fonte
            valign: Gtk.Align.CENTER,
        });

        const syncFromSettings = () => {
            // set_family em vez de from_string: from_string tentaria ler
            // palavras como "Bold" ou "12" do nome como estilo/tamanho.
            const desc = new Pango.FontDescription();
            desc.set_family(settings.get_string(key));
            button.font_desc = desc;
        };
        syncFromSettings();

        button.connect('notify::font-desc', () => {
            const family = button.font_desc?.get_family();
            if (family && family !== settings.get_string(key))
                settings.set_string(key, family);
        });
        this._settingsHandlerIds.push(
            settings.connect(`changed::${key}`, syncFromSettings));

        const row = new Adw.ActionRow({title, subtitle});
        row.add_suffix(button);
        return row;
    }
}
