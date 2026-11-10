// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Vinicius Bispo

// extension.js — roda DENTRO do processo gnome-shell.
//
// Mostra um WIDGET NA ÁREA DE TRABALHO (sobre o papel de parede, abaixo das
// janelas): o dia da semana em hiragana, grande, numa fonte de pincel, e por
// cima do final dele, alinhados à direita, o dia/mês e o ano numa fonte
// estreita e alta. Opcionalmente, a data em kanji e a hora em hiragana.
//
//      げつようび
//              7 abril
//               2025
//      四月七日 月曜日        (opcional)
//      じゅうよじ にじゅっぷん  (opcional)
//
// O widget pode ser arrastado com o mouse; o clique direito abre as
// preferências.
//
// Regras de ouro de uma extensão (cobradas na revisão do extensions.gnome.org):
//   1. Nada acontece ao importar o módulo: só definimos classes e constantes.
//      Todo o trabalho começa em enable().
//   2. Tudo o que enable() cria, disable() destrói: atores, timers, sinais,
//      objetos de settings.

// --- Imports de bibliotecas do sistema (GObject Introspection) -------------
import GLib from 'gi://GLib';         // timers e datas (GLib.DateTime)
import GObject from 'gi://GObject';   // registerClass, para herdar de classes GObject
import St from 'gi://St';             // "Shell Toolkit": widgets do Shell (St.Label…)
import Clutter from 'gi://Clutter';   // layouts, alinhamento, gestos, efeitos
import Cogl from 'gi://Cogl';         // camada gráfica abaixo do Clutter (shaders)
import Pango from 'gi://Pango';       // layout de texto (usado para desligar o "…")

// --- Imports do próprio GNOME Shell ----------------------------------------
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// --- Nosso módulo de conversão (import relativo à pasta da extensão) -------
import * as Hiragana from './hiragana.js';

// Cada âncora vira um par [alinhamento horizontal, alinhamento vertical].
// START = esquerda/topo, CENTER = meio, END = direita/base.
// 'custom' (posição livre, arrastada) é só "canto superior esquerdo com
// margens = coordenadas": o mesmo mecanismo das âncoras, sem código novo.
const ANCHORS = {
    'top-left': ['START', 'START'],
    'top-center': ['CENTER', 'START'],
    'top-right': ['END', 'START'],
    'center-left': ['START', 'CENTER'],
    'center': ['CENTER', 'CENTER'],
    'center-right': ['END', 'CENTER'],
    'bottom-left': ['START', 'END'],
    'bottom-center': ['CENTER', 'END'],
    'bottom-right': ['END', 'END'],
    'custom': ['START', 'START'],
};

// Esquemas de cor → classe CSS aplicada na raiz do widget (ver
// stylesheet.css). Só o prateado usa o degradê (shader).
const COLOR_STYLES = {
    silver: 'hiragana-clock-silver',
    white: 'hiragana-clock-white',
    black: 'hiragana-clock-black',
};

// ---------------------------------------------------------------------------
// Degradê prateado (shader)
// ---------------------------------------------------------------------------
//
// O CSS do St não sabe pintar um degradê DENTRO das letras (só no fundo de
// uma caixa). A solução é um "efeito": o Clutter desenha o texto numa
// textura fora da tela (offscreen) e depois passa cada pixel por um pequeno
// programa da placa de vídeo (fragment shader, em GLSL) antes de mostrar.
//
// Nosso shader roda DEPOIS do processamento normal (por isso o código vai no
// terceiro argumento de Cogl.Snippet.new, o "post"). Nesse ponto,
// cogl_color_out já tem a cor do texto, e o alfa (a) diz onde há letra.
// Trocamos só a cor: misturamos (mix) a cor de cima e a de baixo conforme a
// altura do pixel (cogl_tex_coord_in[0].y vai de 0 no topo a 1 na base).
// A cor é multiplicada pelo alfa porque o Cogl trabalha com "alfa
// pré-multiplicado": um pixel meio transparente guarda a cor já pela metade.
const GRADIENT_DECLARATIONS = `
uniform vec3 top_color;
uniform vec3 bottom_color;
`;
const GRADIENT_CODE = `
float t = cogl_tex_coord_in[0].y;
cogl_color_out.rgb = mix(top_color, bottom_color, t) * cogl_color_out.a;
`;
// Cores do degradê (vermelho, verde, azul, de 0 a 1): quase branco → cinza.
const GRADIENT_TOP = [0.97, 0.97, 0.97];
const GRADIENT_BOTTOM = [0.40, 0.40, 0.42];

// A classe do efeito é registrada só na primeira vez que for usada, dentro
// de um try/catch. Por quê?
// O GNOME 51 recomenda Clutter.ShaderEffect + vfunc_get_static_snippet (o
// antigo Shell.GLSLEffect foi removido no 51). Não tenho certeza de que
// esse vfunc existe no GNOME 50. Se registrássemos a classe no topo do
// módulo e o vfunc não existisse, a extensão inteira falharia ao carregar.
//
// Lição aprendida testando: a primeira versão "perguntava" se o vfunc
// existia lendo Clutter.ShaderEffect.prototype.vfunc_get_static_snippet,
// mas no GJS isso LANÇA um erro ("Virtual function not implemented")
// quando a classe base declara o vfunc sem implementá-lo, e a exceção
// derrubava o enable(). Tentar registrar e capturar a falha é mais simples
// e mais honesto: no pior caso o texto fica num prateado liso (cor do
// stylesheet.css), sem degradê, e a extensão continua funcionando.
let SilverGradientEffect = null;
let gradientUnsupported = false;

function createGradientEffect() {
    if (gradientUnsupported)
        return null;

    try {
        SilverGradientEffect ??= GObject.registerClass(
        class SilverGradientEffect extends Clutter.ShaderEffect {
            vfunc_get_static_snippet() {
                return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
                    GRADIENT_DECLARATIONS, GRADIENT_CODE);
            }
        });
    } catch (e) {
        console.warn(`Hiragana Clock: degradê indisponível nesta versão do GNOME (${e.message})`);
        gradientUnsupported = true;
        return null;
    }

    const effect = new SilverGradientEffect();
    // "uniform" = valor que o JS passa para o shader. 3 = vec3 (r, g, b).
    effect.set_uniform_float('top_color', 3, GRADIENT_TOP);
    effect.set_uniform_float('bottom_color', 3, GRADIENT_BOTTOM);
    return effect;
}

// Monta o pedaço de CSS de uma fonte escolhida pelo usuário. Duas lições
// aprendidas testando no GNOME 51:
//  - o St só aceita UM nome entre aspas na lista de font-family; com dois
//    ("A", "B", serif) ele descarta a regra inteira e loga
//    "Couldn't parse family in font property". Por isso: "Escolhida", genérica.
//  - tiramos aspas, ponto e vírgula e chaves do nome para que um valor
//    estranho no dconf não "quebre" o CSS.
function fontFamilyCss(family, generic) {
    const clean = family.replace(/["';{}\\]/g, '').trim();
    return clean ? `font-family: "${clean}", ${generic};` : '';
}

// ---------------------------------------------------------------------------
// O widget
// ---------------------------------------------------------------------------
//
// Por que GObject.registerClass? St.BoxLayout é uma classe GObject (vem do C).
// Para herdar dela em JS é preciso registrar a subclasse no sistema de tipos
// do GObject. Aproveitamos para declarar sinais próprios: o widget só AVISA
// o que aconteceu (pediram as preferências, terminou de ser arrastado), e
// quem decide o que fazer é a extensão (menos acoplamento: o widget nem sabe
// que existe GSettings).
//
// Árvore de atores:
//   HiraganaWidget (Clutter.Actor: POSIÇÃO — alinhamento, margens, arrasto)
//   └── caixa (St.BoxLayout vertical: APARÊNCIA — CSS, fonte, cor)
//       ├── composição (St.Widget com BinLayout: filhos SOBREPOSTOS)
//       │   ├── dia da semana (canto superior esquerdo)
//       │   └── bloco de data (canto inferior direito, por cima do final)
//       │       ├── "7 abril"
//       │       └── "2025"
//       ├── data em kanji (opcional)
//       └── hora em hiragana (opcional)
//
// POR QUE DUAS CAMADAS (Clutter.Actor por fora, St por dentro)?
// Lição aprendida testando: todo ator St REAPLICA as margens do CSS
// (margin-left etc.) sempre que o estilo dele é recalculado — ao entrar na
// tela e a cada set_style(). Como o CSS não define margem, ele zerava as
// margens que usamos para posicionar: o widget nascia colado na borda e
// "pulava" de volta a cada mudança de fonte. Um Clutter.Actor puro não tem
// CSS, então ninguém mexe nas margens dele.
const HiraganaWidget = GObject.registerClass({
    Signals: {
        'open-preferences': {},
        // param_types: o sinal leva junto a posição final (x, y) em pixels.
        'drag-finished': {param_types: [GObject.TYPE_INT, GObject.TYPE_INT]},
        'drag-cancelled': {},
    },
}, class HiraganaWidget extends Clutter.Actor {
    _init() {
        super._init({
            // BinLayout: o ator fica exatamente do tamanho da caixa de dentro.
            layout_manager: new Clutter.BinLayout(),
            // reactive: recebe os cliques (arrastar, botão direito). Os
            // rótulos de dentro não são reativos, então os eventos de mouse
            // em cima deles chegam a este ator.
            reactive: true,
            // O BinLayout do contêiner da tela só respeita x_align/y_align
            // de filhos com expand ligado; sem isso ele centraliza sempre.
            x_expand: true,
            y_expand: true,
        });

        this._box = new St.BoxLayout({
            // ATENÇÃO (GNOME 51): `vertical: true` foi REMOVIDO do St no 51.
            // `orientation` funciona no 50 e no 51.
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'hiragana-clock-widget',
        });
        this.add_child(this._box);

        // BinLayout empilha os filhos um sobre o outro, cada um alinhado no
        // seu canto. É o que permite a data ficar POR CIMA do final do dia da
        // semana, como na referência. O dia da semana tem padding à direita
        // e embaixo (ver CSS), e é nesse espaço extra que a data "transborda".
        this._composition = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._box.add_child(this._composition);

        this._weekdayLabel = new St.Label({
            style_class: 'hiragana-clock-weekday',
            x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        this._composition.add_child(this._weekdayLabel);

        const dateBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'hiragana-clock-datebox',
            x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
        });
        this._composition.add_child(dateBox);

        // x_align END em cada linha: alinha "2025" à direita de "7 abril".
        this._dayMonthLabel = new St.Label({
            style_class: 'hiragana-clock-daymonth',
            x_align: Clutter.ActorAlign.END,
        });
        this._yearLabel = new St.Label({
            style_class: 'hiragana-clock-year',
            x_align: Clutter.ActorAlign.END,
        });
        dateBox.add_child(this._dayMonthLabel);
        dateBox.add_child(this._yearLabel);

        this._kanjiLabel = new St.Label({style_class: 'hiragana-clock-kanji'});
        this._box.add_child(this._kanjiLabel);

        this._timeLabel = new St.Label({style_class: 'hiragana-clock-time'});
        this._box.add_child(this._timeLabel);

        // Rótulos na fonte japonesa (recebem o degradê no modo prateado) e
        // rótulos na fonte da data.
        this._japaneseLabels = [this._weekdayLabel, this._kanjiLabel, this._timeLabel];
        this._dateLabels = [this._dayMonthLabel, this._yearLabel];
        this._gradientEffects = [];
        this._colorClass = null;

        // Por padrão um St.Label que recebe menos largura do que pediu corta
        // o texto com "…". Num widget de área de trabalho isso nunca é o que
        // queremos (aconteceu nos testes: aparecia "かよ‥"), então desligamos.
        for (const label of [...this._japaneseLabels, ...this._dateLabels])
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        this._setupRightClick();
        this._setupDrag();

        // Se o widget for destruído no meio de um arrasto (ex.: a extensão
        // é desativada), soltamos o "grab" do mouse; senão o Shell inteiro
        // ficaria sem receber cliques.
        this.connect('destroy', () => this._releaseGrab());
    }

    // --- Clique direito → preferências ---------------------------------------
    //
    // Compatibilidade 50/51: no GNOME 51, conectar 'button-press-event'
    // direto no ator ficou OBSOLETO (ainda funciona); o recomendado são os
    // gestos do Clutter (Clutter.ClickGesture), que o próprio Shell 51 usa no
    // menu do fundo da tela. Como não tenho certeza de que ClickGesture
    // existe no GNOME 50, testamos se a classe existe em vez de comparar
    // versões: é mais robusto, porque pergunta exatamente o que precisamos.
    _setupRightClick() {
        if (Clutter.ClickGesture) {
            const gesture = new Clutter.ClickGesture({
                required_button: Clutter.BUTTON_SECONDARY,
                recognize_on_press: true,
            });
            gesture.connect('recognize', () => this.emit('open-preferences'));
            this.add_action(gesture);
        } else {
            this.connect('button-press-event', (_actor, event) => {
                if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                    return Clutter.EVENT_PROPAGATE;
                this.emit('open-preferences');
                return Clutter.EVENT_STOP;
            });
        }
        // Não guardamos ids destes connect: gesto e widget são destruídos
        // juntos, levando as conexões embora.
    }

    // --- Arrastar com o mouse -------------------------------------------------
    //
    // Clutter.PanGesture é o gesto de "arrastar" do GNOME 51 (o mesmo que o
    // Shell usa nos sliders do menu rápido). Ciclo de vida do gesto:
    //   'recognize'  → o mouse foi pressionado e andou alguns pixels: começou
    //   'pan-update' → o mouse andou de novo
    //   'end'        → soltou o botão
    //   'cancel'     → algo interrompeu o gesto
    // Ele só "reconhece" depois de um pequeno movimento, então um clique
    // parado não é confundido com arrasto.
    //
    // Se o Clutter não tiver PanGesture (talvez no GNOME 50; não tenho
    // certeza), o widget simplesmente não arrasta, e todo o resto funciona.
    _setupDrag() {
        if (!Clutter.PanGesture) {
            console.warn('Hiragana Clock: arrastar indisponível (sem Clutter.PanGesture)');
            this._panGesture = null;
            return;
        }

        this._panGesture = new Clutter.PanGesture();
        this._panGesture.connect('recognize', () => this._onDragBegin());
        this._panGesture.connect('pan-update', () => this._onDragUpdate());
        this._panGesture.connect('end', () => this._onDragEnd());
        this._panGesture.connect('cancel', () => this._onDragCancel());
        this.add_action(this._panGesture);
    }

    setDraggable(draggable) {
        // ActorMeta.enabled liga/desliga o gesto sem precisar removê-lo.
        if (this._panGesture)
            this._panGesture.enabled = draggable;
    }

    _onDragBegin() {
        // "Grab": enquanto o botão estiver pressionado, TODOS os eventos do
        // mouse vêm para este ator, mesmo se o ponteiro passar por cima de
        // outra coisa (o Shell faz igual nos sliders).
        this._grab = global.stage.grab(this);

        // Onde o widget está agora, relativo ao contêiner. A "allocation" é
        // a caixa que o layout deu ao ator, já descontadas as margens.
        const box = this.get_allocation_box();
        this._dragStartX = box.x1;
        this._dragStartY = box.y1;

        // Passamos para posição livre já no começo, na mesma posição em que
        // o widget está: assim ele não "pula" ao começar a arrastar.
        this.setPlacement('custom', 0, 0, box.x1, box.y1);
    }

    _onDragUpdate() {
        // get_accumulated_delta_abs(): quanto o mouse andou desde o início
        // do gesto, em coordenadas da TELA. A versão sem "_abs" mede em
        // coordenadas do próprio ator, e como o ator anda junto com o mouse
        // essa medida ficaria perto de zero.
        //
        // O retorno é um Graphene.Vec2 (vetor 2D), lido com get_x()/get_y().
        // Lição aprendida testando: `delta.x` NÃO existe nesse tipo, dava
        // undefined → NaN, e o Clutter recusava a margem com o aviso
        // "assertion 'margin >= 0.f' failed".
        const delta = this._panGesture.get_accumulated_delta_abs();
        const [x, y] = this._clampToParent(
            this._dragStartX + delta.get_x(), this._dragStartY + delta.get_y());
        this.margin_left = x;
        this.margin_top = y;
    }

    _onDragEnd() {
        this._releaseGrab();
        // Avisamos a posição final; a extensão salva no GSettings.
        this.emit('drag-finished', Math.round(this.margin_left), Math.round(this.margin_top));
    }

    _onDragCancel() {
        this._releaseGrab();
        this.emit('drag-cancelled');
    }

    _releaseGrab() {
        this._grab?.dismiss();
        this._grab = null;
    }

    // Mantém o widget inteiro dentro do contêiner (a área útil da tela),
    // para nunca arrastá-lo para fora de alcance.
    _clampToParent(x, y) {
        const parent = this.get_parent();
        const maxX = Math.max(0, parent.width - this.width);
        const maxY = Math.max(0, parent.height - this.height);
        return [Math.clamp(x, 0, maxX), Math.clamp(y, 0, maxY)];
    }

    // --- Conteúdo e aparência -------------------------------------------------

    setTexts({weekday, dayMonth, year, kanji, time}) {
        this._weekdayLabel.text = weekday;
        this._dayMonthLabel.text = dayMonth;
        this._setOptional(this._yearLabel, year);
        this._setOptional(this._kanjiLabel, kanji);
        this._setOptional(this._timeLabel, time);
    }

    _setOptional(label, text) {
        label.text = text;
        label.visible = text !== ''; // escondido = não ocupa espaço
    }

    setFontSize(points) {
        // O tamanho vai na caixa (raiz do CSS): todo o resto usa `em` no
        // stylesheet.css (fração do tamanho do pai), então tudo cresce junto.
        this._box.set_style(`font-size: ${points}pt;`);
    }

    setFonts(japaneseFamily, dateFamily) {
        const japaneseCss = fontFamilyCss(japaneseFamily, 'serif');
        const dateCss = fontFamilyCss(dateFamily, 'sans-serif');
        this._japaneseLabels.forEach(label => label.set_style(japaneseCss));
        this._dateLabels.forEach(label => label.set_style(dateCss));
    }

    // Troca a classe de cor na caixa (o CSS faz o resto) e liga o degradê só
    // no modo prateado.
    setColorStyle(style) {
        if (this._colorClass)
            this._box.remove_style_class_name(this._colorClass);
        this._colorClass = COLOR_STYLES[style] ?? COLOR_STYLES.silver;
        this._box.add_style_class_name(this._colorClass);
        this._setGradient(style === 'silver');
    }

    _setGradient(enabled) {
        // Remove os efeitos antigos (se houver) e cria novos se pedido.
        // Cada efeito só pode estar em UM ator, por isso um por rótulo.
        this._gradientEffects.forEach(({label, effect}) => label.remove_effect(effect));
        this._gradientEffects = [];
        if (!enabled)
            return;
        for (const label of this._japaneseLabels) {
            const effect = createGradientEffect();
            if (!effect)
                return; // Clutter sem suporte: fica a cor lisa do CSS
            label.add_effect(effect);
            this._gradientEffects.push({label, effect});
        }
    }

    // Aplica a posição. Quem calcula onde o widget fica é o Clutter.BinLayout
    // do contêiner (ver _createWidget): ele dá ao widget a área toda, e o
    // widget se encaixa nela conforme x_align/y_align e as margens. Se o texto
    // mudar de largura, o widget continua no canto certo sem fazermos conta.
    setPlacement(anchor, marginX, marginY, customX, customY) {
        const [xAlign, yAlign] = ANCHORS[anchor] ?? ANCHORS['center-left'];
        this.x_align = Clutter.ActorAlign[xAlign];
        this.y_align = Clutter.ActorAlign[yAlign];

        if (anchor === 'custom') {
            // Posição livre: as margens SÃO as coordenadas.
            [marginX, marginY] = [customX, customY];
        }
        // A margem só vale do lado da borda à qual estamos presos; no
        // centro, nenhuma (senão o widget sairia do centro).
        this.margin_left = xAlign === 'START' ? marginX : 0;
        this.margin_right = xAlign === 'END' ? marginX : 0;
        this.margin_top = yAlign === 'START' ? marginY : 0;
        this.margin_bottom = yAlign === 'END' ? marginY : 0;
    }
});

// ---------------------------------------------------------------------------
// A extensão
// ---------------------------------------------------------------------------
//
// O Shell cria UMA instância desta classe e chama enable()/disable() quantas
// vezes for preciso (por exemplo, a cada bloqueio e desbloqueio de tela).
// Por isso todo estado é criado em enable() e zerado em disable().
export default class HiraganaClockExtension extends Extension {
    enable() {
        // getSettings() lê "settings-schema" do metadata.json e procura o
        // schema compilado em schemas/ dentro da pasta da extensão.
        this._settings = this.getSettings();

        // Um único handler para todas as chaves; o segundo argumento diz qual
        // mudou. Guardamos o id para desconectar em disable().
        this._settingsChangedId = this._settings.connect(
            'changed', (_settings, key) => this._onSettingsChanged(key));

        this._syncTimeoutId = 0;
        this._minuteTimeoutId = 0;

        // Só restauramos o relógio do painel se FOMOS NÓS que o escondemos
        // (outra extensão, como a Just Perfection, pode tê-lo escondido).
        this._dateMenuHiddenByUs = false;

        this._createWidget();
        this._syncDefaultClock();
        this._update();
        this._startClock();
    }

    disable() {
        // Ordem inversa de enable(): primeiro o que gera eventos (timers,
        // sinais), depois o que é visível.
        this._stopClock();

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        this._destroyWidget();
        this._restoreDefaultClock();

        this._settings = null;
    }

    // --- Widget na área de trabalho -----------------------------------------

    _createWidget() {
        // ONDE colocar o widget para ele ficar "na área de trabalho"?
        //
        // global.window_group contém as janelas e, no fundo de tudo,
        // Main.layoutManager._backgroundGroup, que guarda o papel de parede.
        // Pondo o widget ali, ele fica acima do papel de parede e ABAIXO de
        // todas as janelas, como um widget de desktop.
        //
        // O "_" indica que _backgroundGroup é INTERNO do Shell, não uma API
        // pública garantida. É a forma usual de fazer widgets de desktop (não
        // existe API pública para isso), mas é o primeiro lugar a conferir se
        // uma versão futura do GNOME quebrar a extensão. Conferi no código do
        // GNOME 51: papéis de parede recriados vão sempre para o FUNDO do
        // grupo (set_child_below_sibling(…, null)), então não cobrem o widget.
        //
        // O contêiner: ator invisível do tamanho da área útil do monitor
        // principal, com BinLayout para alinhar o widget nos cantos/centro.
        // reactive:false é essencial: atores não reativos são ignorados pelos
        // cliques, então o contêiner (que cobre a tela toda) não rouba o
        // clique direito do fundo; só o widget em si é clicável.
        this._container = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
        });

        this._widget = new HiraganaWidget();
        this._widget.connect('open-preferences', () => this.openPreferences());
        this._widget.connect('drag-finished', (_w, x, y) => this._onDragFinished(x, y));
        this._widget.connect('drag-cancelled', () => this._applyPlacement());
        this._container.add_child(this._widget);

        Main.layoutManager._backgroundGroup.add_child(this._container);

        this._applyAppearance();
        this._applyPlacement();
        this._widget.setDraggable(this._settings.get_boolean('draggable'));
        this._updateContainerGeometry();

        // A área útil muda com monitores, resolução, painel e docks. Estes
        // objetos vivem MAIS que a extensão, então guardamos os ids.
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._updateContainerGeometry());
        this._workareasChangedId = global.display.connect(
            'workareas-changed', () => this._updateContainerGeometry());
    }

    _destroyWidget() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._workareasChangedId) {
            global.display.disconnect(this._workareasChangedId);
            this._workareasChangedId = 0;
        }
        // Destruir o contêiner destrói os filhos (widget, gestos, efeitos)
        // junto e o remove do _backgroundGroup.
        this._container?.destroy();
        this._container = null;
        this._widget = null;
    }

    // "Área útil" (workarea) = tela menos painel superior e docks.
    _updateContainerGeometry() {
        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            Main.layoutManager.primaryIndex);
        this._container.set_position(workArea.x, workArea.y);
        this._container.set_size(workArea.width, workArea.height);
    }

    _applyPlacement() {
        const s = this._settings;
        this._widget.setPlacement(
            s.get_string('anchor'),
            s.get_int('margin-x'), s.get_int('margin-y'),
            s.get_int('custom-x'), s.get_int('custom-y'));
    }

    // Terminou de arrastar: guardamos a posição livre. Cada set_* dispara
    // 'changed' na hora → _applyPlacement(). Entre as três gravações a
    // posição "intermediária" pode ser estranha (ex.: x novo com a âncora
    // antiga), mas tudo acontece na mesma rodada do loop do GLib, antes do
    // próximo quadro ser desenhado, então nada pisca na tela.
    // (Evitei settings.delay()/apply(): delay() deixa o objeto em modo
    // "adiado" para sempre, o que surpreenderia qualquer código futuro.)
    _onDragFinished(x, y) {
        this._settings.set_int('custom-x', x);
        this._settings.set_int('custom-y', y);
        this._settings.set_string('anchor', 'custom');
    }

    _applyAppearance() {
        const s = this._settings;
        this._widget.setFontSize(s.get_int('font-size'));
        this._widget.setFonts(s.get_string('hiragana-font'), s.get_string('date-font'));
        this._widget.setColorStyle(s.get_string('color-style'));
    }

    // --- Relógio padrão do painel -------------------------------------------

    _syncDefaultClock() {
        if (this._settings.get_boolean('hide-default-clock'))
            this._hideDefaultClock();
        else
            this._restoreDefaultClock();
    }

    _hideDefaultClock() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        if (!dateMenu || this._dateMenuHiddenByUs)
            return;
        dateMenu.container.hide();
        this._dateMenuHiddenByUs = true;
    }

    _restoreDefaultClock() {
        if (!this._dateMenuHiddenByUs)
            return;
        Main.panel.statusArea.dateMenu?.container.show();
        this._dateMenuHiddenByUs = false;
    }

    // --- Preferências mudaram -----------------------------------------------

    _onSettingsChanged(key) {
        switch (key) {
        case 'anchor':
        case 'margin-x':
        case 'margin-y':
        case 'custom-x':
        case 'custom-y':
            this._applyPlacement();
            break;
        case 'draggable':
            this._widget.setDraggable(this._settings.get_boolean(key));
            break;
        case 'font-size':
        case 'hiragana-font':
        case 'date-font':
        case 'color-style':
            this._applyAppearance();
            break;
        case 'hide-default-clock':
            this._syncDefaultClock();
            break;
        default:
            // show-year, show-kanji, show-time, use-12h, show-choudo:
            // só muda o texto.
            this._update();
        }
    }

    // --- Atualização do texto -----------------------------------------------

    _update() {
        // GLib.DateTime.new_now_local() usa o fuso horário do sistema.
        const now = GLib.DateTime.new_now_local();

        // get_day_of_week() do GLib vai de 1 (segunda) a 7 (domingo);
        // % 7 transforma o domingo em 0, igual a Date.getDay().
        const parts = {
            month: now.get_month(),
            day: now.get_day_of_month(),
            weekday: now.get_day_of_week() % 7,
            hour: now.get_hour(),
            minute: now.get_minute(),
        };

        const s = this._settings;
        let time = '';
        if (s.get_boolean('show-time')) {
            time = [
                Hiragana.hourToHiragana(parts.hour, {use12h: s.get_boolean('use-12h')}),
                Hiragana.minuteToHiragana(parts.minute,
                    {showChoudo: s.get_boolean('show-choudo')}),
            ].filter(Boolean).join(' ');
        }

        this._widget.setTexts({
            weekday: Hiragana.weekdayToHiragana(parts.weekday),
            dayMonth: Hiragana.formatDayMonthPortuguese(parts),
            year: s.get_boolean('show-year') ? String(now.get_year()) : '',
            kanji: s.get_boolean('show-kanji') ? Hiragana.formatKanji(parts) : '',
            time,
        });
    }

    // --- Timers -------------------------------------------------------------
    //
    // Em vez de acordar a CPU a cada segundo, esperamos até o próximo minuto
    // "virar" e, a partir daí, repetimos a cada 60 s. (Mesmo sem a hora na
    // tela, o dia da semana e a data precisam virar à meia-noite.)
    //
    // Por que GLib.timeout_add (milissegundos) e não timeout_add_seconds?
    // timeout_add_seconds agrupa timers e pode disparar em qualquer ponto do
    // segundo; se disparasse em hh:mm:59.6, mostraríamos o minuto antigo por
    // mais 60 s. timeout_add nunca dispara ANTES do prazo, só um pouco depois.

    _startClock() {
        const now = GLib.DateTime.new_now_local();
        const msUntilNextMinute =
            (60 - now.get_second()) * 1000 -
            Math.floor(now.get_microsecond() / 1000);

        this._syncTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, msUntilNextMinute, () => {
                // SOURCE_REMOVE apaga o timer no GLib; zeramos o id para
                // disable() não tentar remover um timer que já não existe.
                this._syncTimeoutId = 0;
                this._update();
                this._minuteTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT, 60 * 1000, () => this._onMinuteTick());
                return GLib.SOURCE_REMOVE;
            });
    }

    _onMinuteTick() {
        this._update();

        // Verificação de deriva: cada disparo atrasa alguns milissegundos, e
        // o relógio do sistema pode ser ajustado (NTP, mudança manual). Fora
        // dos 2 primeiros segundos do minuto, realinhamos.
        const second = GLib.DateTime.new_now_local().get_second();
        if (second > 1) {
            this._minuteTimeoutId = 0;
            this._startClock();
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE; // "me chame de novo daqui a 60 s"
    }

    _stopClock() {
        if (this._syncTimeoutId) {
            GLib.Source.remove(this._syncTimeoutId);
            this._syncTimeoutId = 0;
        }
        if (this._minuteTimeoutId) {
            GLib.Source.remove(this._minuteTimeoutId);
            this._minuteTimeoutId = 0;
        }
    }
}
