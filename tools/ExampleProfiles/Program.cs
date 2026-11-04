// Gera o pacote de exemplos (TrueReplayer-exemplos.trprofile) com os tipos REAIS do app, valida cada
// perfil e confere no resolvedor de tokens as saidas que as descricoes citam. O pacote vai embutido no
// app (Examples\ deste repo, "Use this example"). O 2 tem a copia dele em docs\exemplos\ do repo
// TrueReplayer-releases, que fica como esta: so o 3 recebe os exemplos daqui.
//   1. na raiz do repo: dotnet build TrueReplayer.csproj -c Release -p:Platform=x64
//   2. dotnet build tools\ExampleProfiles -c Release
//   3. cd bin\x64\Release\net8.0-windows10.0.19041.0\win-x64
//      dotnet <repo>\tools\ExampleProfiles\bin\Release\net8.0-windows10.0.19041.0\win-x64\exgen.dll . <saida.trprofile>
// Rodar com o diretorio atual na pasta do build: o WindowsAppSDK procura as DLLs nativas ali.
//
// A matriz de cobertura (cada token, modificador, formato, condicao e passo de fluxo contra os
// exemplos) fica em .claude\planos\exemplos-tr3-2026-11-03.md, no repo do 2 (TrueReplayer-master).
using System.Collections.ObjectModel;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using System.Text.RegularExpressions;

static class Program
{
    static string Dir = "";
    static int Main(string[] args)
    {
        Dir = args[0];
        AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
        {
            var p = Path.Combine(Dir, new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(p) ? Assembly.LoadFrom(p) : null;
        };
        return Run(args[1]);
    }
    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Run(string outFile) => Gen.Run(Dir, outFile).GetAwaiter().GetResult();
}

static class Gen
{
    record Ex(string Name, string Emoji, string Desc, string Tag, List<TrueReplayer.Models.ActionItem> Actions,
              int Loops = 1, TrueReplayer.Models.ProfileDataTable? Data = null, Dictionary<string, string>? Images = null);

    // Atraso de cada linha = o que a UI da a uma linha inserida (CustomDelay padrao, 100 ms);
    // marcadores puros ficam em 0, que e o que o ConditionalBlockValidator normaliza no load.
    static readonly HashSet<string> Marcadores = new() { "Else", "EndIf", "EndLoop", "BreakLoop", "ContinueLoop", "ForEachRow" };
    static TrueReplayer.Models.ActionItem A(string type, Action<TrueReplayer.Models.ActionItem>? cfg = null)
    { var a = new TrueReplayer.Models.ActionItem { ActionType = type, Delay = Marcadores.Contains(type) ? 0 : 100 }; cfg?.Invoke(a); return a; }

    // ── blocos de montagem ─────────────────────────────────────────────────────────────
    static TrueReplayer.Models.ActionItem Abrir(string note = "abre o Bloco de Notas, ou traz para a frente") => A("ActivateWindow", a =>
    { a.WindowProcessName = "notepad"; a.LaunchPath = "notepad.exe"; a.Timeout = 5000; a.Comment = note; });
    static TrueReplayer.Models.ActionItem Txt(string t, string note = "") => A("SendText", a => { a.Key = t; a.Comment = note; });
    // Modo Digitar com 10 ms de Delay por letra: sem ele, o Bloco de Notas do Windows 11 (o com
    // formatação) perde letras de um texto digitado de uma vez — acentos, o @ e linhas inteiras
    // (medido em 03-11). O Colar não tem o problema.
    const int DelayPorLetra = 10;
    static TrueReplayer.Models.ActionItem Digita(string t, string note = "") => A("SendText", a => { a.Key = t; a.SendMethod = "type"; a.SendCharDelay = DelayPorLetra; a.Comment = note; });
    static TrueReplayer.Models.ActionItem Tecla(string k, string note = "", int vezes = 1) => A("Keystroke", a => { a.Key = k; a.RepeatCount = vezes; a.Comment = note; });
    static TrueReplayer.Models.ActionItem Var(string nome, string valor, string note = "", string? modo = null) =>
        A("SetVariable", a => { a.Key = nome; a.VariableValue = valor; a.VariableMode = modo; a.Comment = note; });
    static TrueReplayer.Models.ActionItem CondVar(string tipo, string nome, string op, string valor, string note = "") =>
        A(tipo, a => { a.ConditionType = "Variable"; a.Key = nome; a.ConditionOperator = op; a.ConditionOperand = valor; a.Comment = note; });
    static TrueReplayer.Models.ActionItem Cond(string tipo, string ct, Action<TrueReplayer.Models.ActionItem> cfg, string note = "") =>
        A(tipo, a => { a.ConditionType = ct; cfg(a); a.Comment = note; });
    static TrueReplayer.Models.ActionItem Com(TrueReplayer.Models.ActionItem a, Action<TrueReplayer.Models.ActionItem> cfg) { cfg(a); return a; }
    static TrueReplayer.Models.ActionItem Else() => A("Else");
    static TrueReplayer.Models.ActionItem EndIf(string note = "") => A("EndIf", a => a.Comment = note);
    static TrueReplayer.Models.ActionItem EndLoop(string note = "") => A("EndLoop", a => a.Comment = note);

    // Prepara a entrada: vai ao fim do texto, digita a amostra numa linha nova em modo Type (que
    // nao toca no clipboard), seleciona e copia. O Ctrl+End e o {enter} da frente garantem que a
    // selecao pega SO a amostra, mesmo que o cursor esteja no meio de um texto seu.
    static IEnumerable<TrueReplayer.Models.ActionItem> Copia(string amostra, int linhas, string oque)
    {
        yield return Tecla("Ctrl+End", "prepara: vai para o fim do texto");
        yield return Digita("{enter}" + amostra, "digita " + oque + " (modo Digitar, sem clipboard, 10 ms por letra)");
        yield return Tecla("Shift+Home", "seleciona a linha");
        if (linhas > 1) yield return Tecla("Shift+Up", "estende a seleção às linhas de cima", linhas - 1);
        yield return Tecla("Ctrl+C", "copia");
        yield return Tecla("Ctrl+End", "sai da seleção, no fim do texto");
    }

    // ── a tela: o Bloco de Notas num lugar fixo ─────────────────────────────────────────
    // As condicoes da tela (Text on screen, Pixel color, Image found) e as esperas delas leem uma
    // regiao em pixels da tela. Para a regiao cair dentro do Bloco de Notas em qualquer maquina, o
    // Activate Window poe a janela em (60, 60) com 900 x 600 pixels (o motor tira do maximizado
    // antes), e a macro escreve numa aba nova (Ctrl+N), na 9a linha ({enter:8}). A regiao vai de 220 a
    // 530 px abaixo do topo da janela. Medido a 100% (03-11): o texto comeca 90 px abaixo do topo e cada
    // linha tem 18 px. De 100% a 200% de escala, a 1a linha fica acima da regiao e a 9a dentro dela
    // (a 100%, 234-252 px; a 200%, 468-504), e a barra de status abaixo. O cursor que pisca e lido pelo
    // OCR como uma letra a mais: antes de ler, a macro o leva a 1a linha (Ctrl+Home), fora da regiao.
    // Os pixels sao fisicos (o app e PerMonitorV2).
    const int JanX = 60, JanY = 60, JanW = 900, JanH = 600;
    const int RegX = JanX + 20, RegY = JanY + 220, RegW = JanW - 40, RegH = 310;
    // Um ponto do fundo vazio da aba nova: longe do texto (que fica no alto, a esquerda), da barra de
    // rolagem e da barra de status.
    const int PontoX = JanX + 700, PontoY = JanY + 450;

    static TrueReplayer.Models.ActionItem Colocar() => A("ActivateWindow", a =>
    {
        a.WindowProcessName = "notepad"; a.LaunchPath = "notepad.exe"; a.Timeout = 5000;
        a.RestorePosition = true; a.RestoreSize = true;
        a.WindowX = JanX; a.WindowY = JanY; a.WindowWidth = JanW; a.WindowHeight = JanH;
        a.Comment = "traz o Bloco de Notas e o põe num lugar fixo: a região de leitura fica dentro dele";
    });
    static TrueReplayer.Models.ActionItem AbaNova() => Tecla("Ctrl+N", "uma aba nova: a leitura vê só o que esta macro escreve");
    static void Regiao(TrueReplayer.Models.ActionItem a)
    { a.WaitImageSearchX = RegX; a.WaitImageSearchY = RegY; a.WaitImageSearchW = RegW; a.WaitImageSearchH = RegH; }

    // A imagem de referencia do 30: 8 x 8 pixels, quatro colunas brancas e quatro pretas — a borda
    // esquerda de uma fileira de blocos cheios (█) no tema claro. A busca (TM_CCOEFF_NORMED) compara a
    // forma, nao o brilho: no tema escuro ela acha a borda direita da fileira, clara e depois escura.
    // Uma imagem de uma cor so nao serve: o motor a recusa (IsFlatTemplate).
    const string Borda = "borda.png";
    static string BordaPng() => Convert.ToBase64String(Png(8, 8, (x, _) => x < 4 ? (byte)255 : (byte)0));

    static List<TrueReplayer.Models.ActionItem> L(params object[] xs)
    {
        var l = new List<TrueReplayer.Models.ActionItem>();
        foreach (var x in xs)
            if (x is TrueReplayer.Models.ActionItem a) l.Add(a);
            else if (x is IEnumerable<TrueReplayer.Models.ActionItem> e) l.AddRange(e);
        return l;
    }

    // Ordem do pacote = ordem da galeria dentro de cada grupo (a galeria agrupa pela 2a tag). Os
    // numeros novos (19 em diante) seguem a ordem dos grupos; os antigos ficam com o nome de sempre,
    // porque a galeria reconhece pelo nome o exemplo que ja esta na biblioteca.
    static List<Ex> Exemplos() => new()
    {
        // ══ Tokens ══════════════════════════════════════════════════════════════════════
        new("01 · Olá com Enter", "👋",
            "Digita duas linhas no Bloco de Notas. {enter} e {tab} dentro do texto viram teclas de verdade, e {delay:1000} espera 1 segundo antes de seguir. Selecione a macro e aperte Reproduzir.",
            "tokens", L(Abrir(),
                Txt("Olá! Tudo bem?{enter}Segue o código:{tab}ABC-123{delay:1000} — pronto!{enter}{enter}", "{enter} e {tab} são teclas; {delay:1000} espera 1 s"))),

        new("02 · Datas", "📅",
            "Datas e horas lidas na hora de rodar. Depois do nome vêm o deslocamento (+7 dias, -1, +2w semanas, +1mo mês, +1y ano, +1h, +30min, +45s) e o formato (dd/MM/yyyy, dddd, MMMM, HH:mm). Uma letra só, como D, é um formato pronto, no padrão regional do Windows. Maiúsculas importam: MM é mês, mm é minuto.",
            "tokens", L(Abrir(),
                Txt("Hoje: {date} — agora: {time}{enter}", "data e hora de agora"),
                Txt("As duas juntas: {datetime}{enter}", "{datetime} = data - hora"),
                Txt("Daqui a 7 dias: {date:+7:dd/MM/yyyy} · em 2 semanas: {date:+2w:dd/MM}{enter}", "+7 = dias; w = semanas"),
                Txt("Ontem foi {date:-1:dddd}; o mês que vem é {date:+1mo:MMMM} e o ano que vem, {date:+1y:yyyy}.{enter}", "mo = meses, y = anos; dddd e MMMM são nomes"),
                Txt("Daqui a 1h30: {time:+1h:+30min:HH:mm} · em 45 s: {time:+45s:HH:mm:ss}{enter}", "h, min e s mexem na hora; os deslocamentos somam"),
                Txt("Por extenso: {date:D}{enter}{enter}", "D = a data longa do Windows"))),

        new("03 · Sorteio", "🎲",
            "{Pick:…} sorteia uma frase e {random:a-b} um número. Cada ocorrência sorteia a sua: rode duas vezes e compare.",
            "tokens", L(Abrir(),
                Txt("{Pick:Olá|Oi|Bom dia}! Seu número da sorte: {random:1-60}{enter}", "sorteia a frase e o número"),
                Txt("Dois dados: {random:1-6} e {random:1-6}{enter}{enter}", "cada {random} sorteia o seu"))),

        new("04 · Limpar o copiado", "🧹",
            "Digita uma amostra, copia e usa {clipboard} com modificadores. A ordem importa: trim limpa as pontas, lower baixa tudo e title capitaliza cada palavra. noaccents tira os acentos, digits deixa só os números e replace troca um pedaço por outro. Usa o seu clipboard.",
            "tokens", L(Abrir(),
                Copia("  maria JOSÉ pereira  ", 1, "um nome sujo"),
                Txt("{enter}Como veio: [{clipboard}]{enter}", "o clipboard cru, com os espaços"),
                Txt("Limpo: {clipboard:trim:lower:title}{enter}", "trim → lower → title"),
                Txt("Sem acentos: {clipboard:trim:noaccents:upper}{enter}", "noaccents tira os acentos"),
                Copia("+55 (11) 98888-7777", 1, "um telefone"),
                Txt("{enter}Só os dígitos: {clipboard:digits}{enter}", "digits mantém só 0–9"),
                Txt("Outro DDD: {clipboard:replace:(11):(21)}{enter}{enter}", "replace troca (11) por (21)"))),

        new("05 · Recortar", "✂️",
            "Recorta um pedaço do que foi copiado: uma linha, palavras, o que vem antes ou depois de um marcador (o último, com beforelast e afterlast) e as primeiras ou últimas letras. default diz o que digitar quando o pedaço vem vazio. Os espaços do marcador contam: ' - ' não é '-'. Usa o seu clipboard.",
            "tokens", L(Abrir(),
                Copia("Maria Souza{enter}maria@email.com{enter}Vendedor - 2x Caixa Rara", 3, "um cadastro de 3 linhas"),
                Txt("{enter}Linha 2: {clipboard:line:2} · 1ª palavra: {clipboard:word:1} · as duas primeiras: {clipboard:words:1-2}{enter}", "line, word e words"),
                Txt("Antes do @: {clipboard:line:2:before:@} · antes do último ponto: {clipboard:line:2:beforelast:.} · depois dele: {clipboard:line:2:afterlast:.}{enter}", "before, beforelast e afterlast"),
                Txt("Depois de ' - ': {clipboard:line:3:after: - } · sem a quantidade: {clipboard:line:3:after: - :dropnum:x }{enter}", "o marcador tem espaços; dropnum tira o '2x '"),
                Txt("5 primeiras letras: {clipboard:line:2:first:5} · 4 últimas: {clipboard:line:2:last:4}{enter}", "first e last contam letras"),
                Txt("Linha 4: {clipboard:line:4:default:(não tem)}{enter}{enter}", "não há 4ª linha: default entra no lugar"))),

        new("06 · Listas", "📋",
            "Trata o clipboard como lista, uma linha por item: ordena, tira as repetidas, conta, inverte, pega um trecho (range) ou linhas escolhidas (lines) e junta numa frase (join; sentence põe a primeira letra em maiúscula). Usa o seu clipboard.",
            "tokens", L(Abrir(),
                Copia("banana{enter}maçã{enter}banana{enter}abacaxi", 4, "uma lista de 4 linhas"),
                Txt("{enter}Em ordem, sem repetidas: {clipboard:sort:dedupe:join:, :sentence}.{enter}", "sort → dedupe → join → sentence"),
                Txt("Quantas diferentes: {clipboard:dedupe:count}{enter}", "count conta as linhas"),
                Txt("De trás para frente: {clipboard:reverse:join: / }{enter}", "reverse inverte a ordem"),
                Txt("Da 2ª à 3ª: {clipboard:range:2-3:join: e } · a 4ª e a 1ª: {clipboard:lines:4,1:join:, }{enter}{enter}", "range pega um trecho; lines, as linhas pedidas"))),

        new("19 · Teclas de edição", "⌨️",
            "As outras teclas do texto: {home} e {end} vão ao começo e ao fim da linha, as setas andam, {backspace} e {delete} apagam para trás e para a frente e {space} é um espaço. {escape} (ou {esc}) aperta Esc: no texto não escreve nada, e num app fecha um menu ou uma caixa. Um número depois da tecla repete: {backspace:3} apaga três. {pageup} e {pagedown} sobem e descem uma página.",
            "tokens", L(Abrir(),
                Tecla("Ctrl+End", "vai para o fim do texto"),
                Txt("{enter}Rascunho: ABCXYZ{backspace:3}DEF{enter}", "{backspace:3} apaga 3 para trás"),
                Txt("abcd{left:2}{delete}X{right}!{enter}", "{left:2} volta 2; {delete} apaga para a frente; {right} anda 1"),
                Txt("meio{home}Começo → {end} ← fim{enter}", "{home} e {end}: começo e fim da linha"),
                Txt("Linha A{enter}Linha B{up}{end} (em cima){down}{end} (embaixo){enter}", "{up} e {down} trocam de linha"),
                Txt("Espaços: um{space}dois{space:3}três{enter}", "{space:3} = três espaços"),
                Txt("Esc não escreve nada:{escape} viu?{esc}{enter}", "{escape} e {esc} são a mesma tecla, não um texto"),
                Txt("{pageup}{delay:500}{pagedown}", "sobe uma página, espera meio segundo e desce"),
                Tecla("Ctrl+End", "fim do texto"),
                Txt("Fim das teclas.{enter}{enter}"))),

        new("20 · Valores da máquina", "🆔",
            "Valores da máquina e gerados na hora: {env:NOME} lê uma variável de ambiente do Windows, {timestamp} é o Unix time em segundos (:ms, em milissegundos) e {uuid} cria um identificador novo a cada uso. Os três aceitam modificadores. Para usar o mesmo id duas vezes, guarde-o num Set Variable.",
            "tokens", L(Abrir(),
                Txt("{enter}Usuário: {env:USERNAME} · máquina: {env:COMPUTERNAME:lower}{enter}", "{env:} lê o Windows; lower baixa"),
                Txt("Unix time: {timestamp} s · {timestamp:ms} ms · senha curta: {timestamp:last:4}{enter}", "last:4 = os 4 últimos dígitos"),
                Txt("Um id novo a cada uso: {uuid} e {uuid:first:8:upper}{enter}", "cada {uuid} é outro"),
                Var("pedido", "{uuid:first:8}", "guarda um id para usar duas vezes"),
                Txt("O mesmo id duas vezes: {var:pedido} = {var:pedido}{enter}{enter}", "a variável não muda"))),

        new("21 · Slots e histórico", "📎",
            "Além do {clipboard}: {winclip:N} lê o histórico do Win+V (1 é o mais recente; precisa estar ligado em Configurações do Windows) e Copy to Slot guarda a seleção num slot com nome, lido por {clip:nome}, sem mexer no seu clipboard. Limpar esvazia o slot. Aqui tudo é digitado no modo Digitar, para não entrar no histórico. Usa o seu clipboard.",
            "tokens", L(Abrir(),
                Tecla("Ctrl+End", "vai para o fim do texto"),
                Digita("{enter}primeiro", "um texto (modo Digitar)"),
                Tecla("Shift+Home", "seleciona a linha"),
                Tecla("Ctrl+C", "copia: entra no histórico"),
                Tecla("End", "sai da seleção"),
                Digita("{enter}segundo", "outro texto"),
                Tecla("Shift+Home", "seleciona a linha"),
                Tecla("Ctrl+C", "copia: agora este é o mais recente"),
                Tecla("End", "sai da seleção"),
                Com(Digita("{enter}Win+V: o mais recente é {winclip:1:default:(histórico desligado)}; o anterior, {winclip:2:default:(histórico desligado)}", "1 s de Delay: o Windows leva um instante para pôr a cópia no histórico; default aparece com ele desligado"), a => a.Delay = 1000),
                Digita("{enter}Nota 123", "a linha que vai para o slot"),
                Tecla("Shift+Home", "seleciona a linha"),
                A("CopyToSlot", a => { a.Key = "nota"; a.Comment = "guarda a seleção no slot nota"; }),
                Tecla("End", "sai da seleção"),
                Cond("If", "ClipboardMatch", a => { a.ClipboardPatternType = "equals"; a.ClipboardPattern = "segundo"; }, "Clipboard Igual a segundo: o Copy to Slot não o trocou"),
                Digita("{enter}No slot: {clip:nota:upper}. O clipboard continua {clipboard}.", "o slot e o clipboard, lado a lado"),
                EndIf(),
                A("CopyToSlot", a => { a.Key = "nota"; a.SlotMode = "clear"; a.Comment = "Limpar: esvazia o slot nota"; }),
                Digita("{enter}Depois de Limpar: {clip:nota:default:(vazio)}{enter}{enter}", "o slot vazio, e default no lugar"))),

        new("22 · Uma linha por vez", "➡️",
            "A tabela fica na aba Data Loop, no modo Uma linha por vez: cada Reproduzir usa a próxima linha e, depois da última, volta à 1 e avisa que a lista recomeçou. {row:coluna} lê a linha da vez e {datarow} diz qual é ela. {rownext:coluna} anda uma linha a cada uso e recomeça a cada execução. Aperte Reproduzir três vezes.",
            "tokens", L(Abrir(),
                Txt("{enter}Linha {datarow:pad:2} de 3: {row:nome}, de {row:cidade:title}, pedido nº {row:pedido:pad:4}{enter}", "a linha da vez, com modificadores"),
                Txt("A fila toda, numa execução só: {rownext:nome} ({rownext:cidade:title}), {rownext:nome} ({rownext:cidade:title}) e {rownext:nome} ({rownext:cidade:title}){enter}{enter}", "cada {rownext} pega a próxima linha daquela coluna")),
            Data: new TrueReplayer.Models.ProfileDataTable
            {
                Headers = new() { "nome", "cidade", "pedido" },
                Rows = new()
                {
                    new() { "Ana", "são paulo", "7" },
                    new() { "Bruno", "curitiba", "12" },
                    new() { "Carla", "belo horizonte", "3" },
                },
                // Uma linha por vez (o modo cursor): cada execucao consome a proxima, e o aviso de
                // lista recomecando fica ligado de proposito.
                LoopOverData = false,
                NotifyOnLapComplete = true,
            }),

        new("23 · Todas as linhas", "📚",
            "No modo Todas de uma vez (aba Data Loop), um Reproduzir roda a macro inteira uma vez para cada linha da tabela, no lugar do Loops. {row:coluna} é a linha da vez e {datarow}, o número dela. @datarow usa esse número como índice: aqui ele pega o brinde da mesma linha numa lista guardada numa variável.",
            "tokens", L(Abrir(),
                Var("brindes", "chaveiro\nadesivo\nboné", "um brinde por linha da tabela, na mesma ordem"),
                Txt("{enter}{datarow}. {row:produto} — R$ {row:preco} — brinde: {var:brindes:line:@datarow}{enter}", "@datarow = o número da linha da vez")),
            Data: new TrueReplayer.Models.ProfileDataTable
            {
                Headers = new() { "produto", "preco" },
                Rows = new()
                {
                    new() { "Caneca", "25" },
                    new() { "Caneta", "4" },
                    new() { "Mochila", "120" },
                },
                LoopOverData = true,
                NotifyOnLapComplete = false,
            }),

        // ══ Variáveis ═══════════════════════════════════════════════════════════════════
        new("07 · Guardar e reusar", "💾",
            "Set Variable guarda um valor na hora. Ele fica fixo até o fim da execução, mesmo que o clipboard mude depois. Nomes: letras, números e _.",
            "variáveis", L(Abrir(),
                Copia("  joão carvalho  ", 1, "um nome"),
                Var("cliente", "{clipboard:trim:title}", "guarda o nome já limpo"),
                Copia("outra coisa", 1, "outro texto"),
                Txt("{enter}Olá, {var:cliente}!{enter}", "a variável não mudou"),
                Txt("Em maiúsculas: {var:cliente:upper}{enter}", "modificadores valem em {var:}"),
                Txt("E o clipboard agora é: {clipboard}{enter}{enter}", "este sim mudou"))),

        new("08 · Perguntar", "💬",
            "{input:…} abre uma janelinha na hora de rodar; com |menu: vira uma lista. Guardada num Set Variable, a resposta pode ser usada quantas vezes quiser.",
            "variáveis", L(Abrir(),
                Var("nome", "{input:Seu nome}", "campo livre"),
                Var("produto", "{input:Produto|menu:Caixa,Chave,Mapa}", "lista de opções"),
                Txt("{enter}{var:nome} escolheu: {var:produto}.{enter}", "a resposta vira variável"),
                Txt("Confirmando o pedido de {var:produto:upper}.{enter}{enter}", "e pode ser reusada"))),

        new("09 · Contar e somar", "🔢",
            "A macro roda 3 vezes (Loops = 3). {counter} é a volta; Set Variable em Somar acumula a cada volta, porque a variável dura a execução inteira.",
            "variáveis", L(Abrir(),
                Var("total", "10", "modo Somar: +10 a cada volta", "add"),
                Txt("Item {counter:pad:3} — total: {var:total}{enter}", "pad:3 completa com zeros")), Loops: 3),

        new("10 · Rodízio", "🔁",
            "Set Variable em Ciclo guarda o PRÓXIMO item da lista a cada execução e volta ao começo no fim. A posição fica gravada: rode várias vezes. Botão direito na linha → Redefinir posição do ciclo recomeça.",
            "variáveis", L(Abrir(),
                Var("saudacao", "Bom dia\nOlá\nOi, tudo bem?", "modo Ciclo: um item por linha", "cycle"),
                Txt("{var:saudacao} — esta execução pegou este.{enter}", "rode de novo: vem o próximo"))),

        new("11 · Número vindo de variável", "🎯",
            "Onde um modificador pede um número, @nome usa o valor de uma variável. Reservados: @counter é a volta da execução, @loop a do While ou For Each, @datarow a linha da tabela e @row o número deste passo na lista, que {row} digita. Roda 3 vezes (Loops = 3).",
            "variáveis", L(Abrir(),
                Var("lista", "Ana\nBia\nCaio", "três nomes, um por linha"),
                Var("i", "2", "um número guardado"),
                Txt("Volta {counter}: {var:lista:line:@counter} — e a {var:i}ª é sempre {var:lista:line:@i}{enter}", "line:@counter e line:@i"),
                Txt("Este é o passo {row}; a {row}ª linha da lista: {var:lista:line:@row:default:não há}{enter}", "@row = o número deste passo; a lista só tem 3")), Loops: 3),

        new("24 · Percorrer uma lista", "🧾",
            "Anda por uma lista guardada numa variável, um item por volta do While: @loop é o número da volta, e line:@loop pega a linha com esse número. Quando a linha vem vazia, o Break loop sai. count conta os itens e {loop:pad:2} numera com dois dígitos. Máx. de voltas (20) é o freio de emergência.",
            "variáveis", L(Abrir(),
                Var("fila", "Ana\nBia\nCaio\nDavi", "a lista, um nome por linha"),
                Txt("{enter}{var:fila:count} nomes na fila:{enter}", "count conta as linhas"),
                A("While", a => { a.ConditionType = "Variable"; a.Key = "fila"; a.ConditionOperator = "neq"; a.ConditionOperand = ""; a.LoopMaxIterations = 20; a.Comment = "sempre vale: quem para é o Break loop"; }),
                Var("nome", "{var:fila:line:@loop}", "@loop = a volta: na 1ª volta, a 1ª linha"),
                CondVar("If", "nome", "eq", "", "a linha veio vazia: a lista acabou"),
                A("BreakLoop", a => a.Comment = "Break loop: sai do While"),
                EndIf(),
                Txt("{loop:pad:2}. {var:nome}{enter}", "pad:2 = dois dígitos"),
                EndLoop("volta para o While"),
                Txt("Fim da fila.{enter}{enter}"))),

        // ══ Condicionais ════════════════════════════════════════════════════════════════
        new("12 · Primeiro If", "❓",
            "If Variable compara uma variável com um valor; com números, maior e menor comparam como número. Rode com 0 e depois com 5 para ver os dois caminhos.",
            "condicionais", L(Abrir(),
                Var("estoque", "{input:Unidades em estoque}", "digite um número"),
                CondVar("If", "estoque", "gt", "0", "estoque > 0?"),
                Txt("{enter}Temos {var:estoque} unidades.{enter}{enter}", "caminho do sim"),
                Else(),
                Txt("{enter}Esgotado — avise o cliente.{enter}{enter}", "caminho do não"),
                EndIf())),

        new("13 · Escada", "🪜",
            "Else If acrescenta perguntas ao mesmo bloco. Elas são checadas de cima para baixo e a primeira que vale vence; o Else é o caminho de quando nenhuma valeu.",
            "condicionais", L(Abrir(),
                Var("motivo", "{input:Motivo|menu:Troca,Devolução,Dúvida,Outro}", "escolha um motivo"),
                CondVar("If", "motivo", "eq", "Troca", "1ª pergunta"),
                Txt("{enter}Vamos iniciar sua troca.{enter}{enter}"),
                CondVar("ElseIf", "motivo", "eq", "Devolução", "só é checada se a de cima deu não"),
                Txt("{enter}Vamos processar a devolução.{enter}{enter}"),
                CondVar("ElseIf", "motivo", "eq", "Dúvida"),
                Txt("{enter}Pode perguntar, estamos aqui.{enter}{enter}"),
                Else(),
                Txt("{enter}Encaminhando para um atendente.{enter}{enter}", "nenhuma valeu"),
                EndIf())),

        new("14 · Perguntas ao sistema", "🖥️",
            "O If também pergunta ao Windows: janela aberta (pelo processo e pelo título, com Contém ou Regex), processo rodando, hora do dia (a faixa das 18:00 às 05:00 passa da meia-noite), arquivo existe, o que está no clipboard e uma moeda. Process running vê o Chrome mesmo sem janela. As respostas mudam de máquina para máquina e de hora para hora.",
            "condicionais", L(Abrir(),
                Cond("If", "WindowOpen", a => { a.WindowProcessName = "notepad"; a.WindowTitleMatchMode = "regex"; a.WindowTitle = "Bloco de Notas|Notepad"; }, "Window open: processo notepad e título por Regex (pt ou en)"),
                Txt("{enter}O Bloco de Notas está aberto.{enter}"),
                EndIf(),
                Cond("If", "ProcessRunning", a => a.WindowProcessName = "chrome", "Process running: o Chrome está rodando?"),
                Txt("O Chrome está rodando.{enter}"),
                Else(),
                Txt("O Chrome não está rodando.{enter}"),
                EndIf(),
                Cond("If", "WindowOpen", a => a.WindowTitle = "Google Chrome", "Window open: título Contém Google Chrome"),
                Txt("E há uma janela do Chrome aberta.{enter}"),
                Else(),
                Txt("Nenhuma janela do Chrome aberta.{enter}"),
                EndIf(),
                Cond("If", "TimeWindow", a => { a.TimeStart = "05:00"; a.TimeEnd = "12:00"; }, "Time: de manhã?"),
                Txt("Bom dia!{enter}"),
                Cond("ElseIf", "TimeWindow", a => { a.TimeStart = "12:00"; a.TimeEnd = "18:00"; }, "de tarde? (12:00 em ponto já ficou no de cima)"),
                Txt("Boa tarde!{enter}"),
                Cond("ElseIf", "TimeWindow", a => { a.TimeStart = "18:00"; a.TimeEnd = "05:00"; }, "de noite: a faixa passa da meia-noite"),
                Txt("Boa noite!{enter}"),
                EndIf(),
                Cond("If", "FileExists", a => a.FilePath = "{env:WINDIR}\\notepad.exe", "File exists: o caminho aceita tokens"),
                Txt("O arquivo {env:WINDIR}\\notepad.exe existe.{enter}"),
                EndIf(),
                Cond("If", "ClipboardMatch", a => { a.ClipboardPatternType = "regex"; a.ClipboardPattern = "^\\d{11}$"; }, "Clipboard: 11 dígitos (regex)?"),
                Txt("O clipboard parece um CPF.{enter}"),
                Else(),
                Txt("O clipboard não é um CPF — copie 11 dígitos e rode de novo.{enter}"),
                EndIf(),
                Cond("If", "Random", a => a.RandomPercent = 50, "Random: 50% de chance"),
                Txt("Moeda: cara.{enter}{enter}"),
                Else(),
                Txt("Moeda: coroa.{enter}{enter}"),
                EndIf())),

        new("15 · Repetir", "🔄",
            "While repete enquanto a condição vale; {loop} é a volta do bloco. Next iteration pula o resto da volta, Break loop sai do bloco. Máx. de voltas (20) é o freio de emergência.",
            "condicionais", L(Abrir(),
                Var("i", "0", "começa do zero"),
                Txt("{enter}Contando:{enter}"),
                A("While", a => { a.ConditionType = "Variable"; a.Key = "i"; a.ConditionOperator = "lt"; a.ConditionOperand = "10"; a.LoopMaxIterations = 20; a.Comment = "enquanto i < 10"; }),
                Var("i", "1", "modo Somar: i + 1", "add"),
                CondVar("If", "i", "eq", "3"),
                Txt("(pulando o 3){enter}"),
                A("ContinueLoop", a => a.Comment = "Next iteration: volta para o While"),
                EndIf(),
                CondVar("If", "i", "eq", "6"),
                Txt("Chegou no 6: Break encerra o loop.{enter}{enter}"),
                A("BreakLoop", a => a.Comment = "Break loop: sai do While"),
                EndIf(),
                Txt("Volta {loop}: i = {var:i}{enter}"),
                EndLoop("volta para o While"))),

        new("16 · Exigir e encerrar", "🛑",
            "Assert exige, e Se falhar diz o que fazer: Abortar para com erro, Parar sem erro encerra sem erro e Continuar segue (fora do horário comercial, nada muda). Return encerra só a volta; Stop, a execução inteira. Loops = 5, mas só 3 voltas rodam. A pergunta vem uma vez e vale para a execução toda. Responda não para ver o Parar sem erro.",
            "condicionais", L(Abrir(),
                Cond("Assert", "WindowOpen", a => { a.WindowProcessName = "notepad"; a.WindowMatchForegroundOnly = true; a.ConditionTimeout = 3000; }, "Bloco de Notas na frente (Abortar)"),
                Cond("Assert", "TimeWindow", a => { a.TimeStart = "08:00"; a.TimeEnd = "18:00"; a.DaysOfWeek = 0b0111110; a.AssertOnFail = "Continue"; }, "horário comercial, de segunda a sexta (Continuar)"),
                Var("seguir", "{input:Continuar?|menu:sim,não}", "responda não para ver o Parar sem erro"),
                Cond("Assert", "Variable", a => { a.Key = "seguir"; a.ConditionOperator = "eq"; a.ConditionOperand = "sim"; a.AssertOnFail = "StopReplay"; }, "você escolheu não seguir"),
                Var("volta", "{counter}", "o número da volta"),
                Txt("Volta {counter}: "),
                CondVar("If", "volta", "eq", "2"),
                Txt("Return encerra só esta volta.{enter}"),
                A("Return", a => a.Comment = "Return: a próxima volta roda"),
                EndIf(),
                CondVar("If", "volta", "eq", "3"),
                Txt("Stop encerra a execução inteira.{enter}{enter}"),
                A("Stop", a => a.Comment = "Stop: as voltas 4 e 5 nunca rodam"),
                EndIf(),
                Txt("segue normal.{enter}")), Loops: 5),

        new("25 · If dentro de If", "🪆",
            "Um If dentro do outro: o de dentro só é checado quando o de fora deixa passar. Aqui há um If de cada lado do Else, e não há limite de níveis. Rode com VIP e 150, depois com Comum e 150, para ver caminhos diferentes.",
            "condicionais", L(Abrir(),
                Var("cliente", "{input:Tipo de cliente|menu:VIP,Comum}", "escolha o tipo"),
                Var("valor", "{input:Valor do pedido}", "digite um número"),
                CondVar("If", "cliente", "eq", "VIP", "If de fora"),
                CondVar("If", "valor", "gt", "100", "If de dentro: só roda para VIP"),
                Txt("{enter}VIP acima de 100: frete grátis e brinde.{enter}{enter}"),
                Else(),
                Txt("{enter}VIP: frete grátis.{enter}{enter}"),
                EndIf(),
                Else(),
                CondVar("If", "valor", "gt", "200", "If de dentro: só roda para Comum"),
                Txt("{enter}Comum acima de 200: frete grátis.{enter}{enter}"),
                Else(),
                Txt("{enter}Comum: frete normal.{enter}{enter}"),
                EndIf(),
                EndIf("fecha o If de fora"))),

        new("26 · Esperar por você", "⏳",
            "Pause espera uma tecla (aqui F8) ou o timeout, o que vier primeiro. Wait until… espera uma condição: aqui, um texto com @ no clipboard, por até 15 s; se não vier, a execução para sem erro. Se o seu clipboard já tem um @, ela passa na hora.",
            "condicionais", L(Abrir(),
                Txt("{enter}Aperte F8 para seguir (ou espere 10 s).{enter}"),
                A("Pause", a => { a.Key = "F8"; a.Timeout = 10000; a.Comment = "Pause: F8 ou 10 s, o que vier primeiro"; }),
                Txt("Seguiu. Agora copie um e-mail (um texto com @) em até 15 s.{enter}"),
                Cond("Assert", "ClipboardMatch", a => { a.ClipboardPatternType = "contains"; a.ClipboardPattern = "@"; a.ConditionTimeout = 15000; a.AssertOnFail = "StopReplay"; }, "Wait until…: o clipboard Contém @ (Parar sem erro se não vier)"),
                Abrir("o Bloco de Notas de volta à frente (você copiou em outro lugar)"),
                Txt("Recebi: {clipboard}{enter}{enter}"))),

        new("27 · Ler a tela", "🔎",
            "Text on screen lê uma região da tela com o OCR do Windows e compara: Contém, Igual a, Regex ou Número. A Cor do texto faz ler só o texto daquela cor: o primeiro If pede vermelho e não acha nada. A macro põe o Bloco de Notas num lugar fixo, escreve numa aba nova e tira o cursor da região antes de ler. Set Variable no modo Tela guarda o número lido. Sem o idioma do OCR, a condição dá erro e a execução para.",
            "condicionais", L(Colocar(), AbaNova(),
                Txt("{enter:8}PEDIDO 4521 APROVADO", "oito linhas para baixo: o texto cai dentro da região"),
                Tecla("Ctrl+Home", "o cursor vai para a 1ª linha, fora da região: piscando, ele vira uma letra a mais"),
                A("WaitText", a => { Regiao(a); a.ConditionOperator = "contains"; a.ConditionOperand = "APROVADO"; a.Timeout = 5000; a.Comment = "espera o OCR ler o texto (Contém)"; }),
                Cond("If", "ScreenText", a => { Regiao(a); a.ConditionOperator = "contains"; a.ConditionOperand = "APROVADO"; a.OcrTextColor = "#FF0000"; a.OcrColorTolerance = 70; a.IfOnProbeError = "Halt"; }, "Contém, com a Cor do texto vermelha: o Bloco de Notas não tem texto vermelho"),
                Var("como", "Cor do texto: achei APROVADO em vermelho", "o resultado fica guardado: a macro só escreve depois de ler"),
                Cond("ElseIf", "ScreenText", a => { Regiao(a); a.ConditionOperator = "eq"; a.ConditionOperand = "PEDIDO 4521 APROVADO"; a.IfOnProbeError = "Halt"; }, "Igual a: a região inteira lê só isto"),
                Var("como", "Igual a: a região mostra só aquela linha"),
                Cond("ElseIf", "ScreenText", a => { Regiao(a); a.ConditionOperator = "regex"; a.ConditionOperand = "PEDIDO \\d{4}"; a.IfOnProbeError = "Halt"; }, "Regex: PEDIDO e quatro dígitos"),
                Var("como", "Regex: achei PEDIDO e quatro dígitos"),
                EndIf(),
                A("SetVariable", a => { a.Key = "pedido"; a.VariableMode = "screen"; a.OcrReadAs = "number"; Regiao(a); a.ConditionTimeout = 2000; a.Comment = "modo Tela, Ler como Número: o primeiro número da região"; }),
                Cond("If", "ScreenText", a => { Regiao(a); a.OcrReadAs = "number"; a.ConditionOperator = "gt"; a.ConditionOperand = "4000"; a.ConditionTimeout = 2000; a.IfOnProbeError = "Halt"; }, "Número > 4000, esperando até 2 s"),
                Var("tamanho", "passa de 4000"),
                Else(),
                Var("tamanho", "não passa de 4000"),
                EndIf(),
                Tecla("Ctrl+End", "agora sim, escreve no fim"),
                Txt("{enter}{enter}{var:como}.{enter}O pedido {var:pedido} {var:tamanho}.{enter}"))),

        new("28 · Esperar um texto", "👀",
            "Wait Text espera a tela: Aparece segura a macro até o OCR ler o texto, Some até ele sumir e Muda até a região mostrar outra coisa. A macro escreve numa aba nova, troca AGUARDE por PRONTO e espera cada mudança, com o cursor fora da região. No Muda, clique na linha do PRONTO e digite algo em até 8 s; sem isso, o timeout segue (Se der timeout: Continuar).",
            "condicionais", L(Colocar(), AbaNova(),
                Txt("{enter:8}AGUARDE", "oito linhas para baixo: dentro da região"),
                Tecla("Ctrl+Home", "o cursor sai da região: piscando, ele mudaria a leitura"),
                A("WaitText", a => { Regiao(a); a.ConditionOperator = "contains"; a.ConditionOperand = "AGUARDE"; a.Timeout = 5000; a.Comment = "Aparece: espera ler AGUARDE"; }),
                Tecla("Ctrl+End", "de volta ao fim de AGUARDE"),
                Txt("{backspace:7}PRONTO", "troca AGUARDE por PRONTO"),
                Tecla("Ctrl+Home", "o cursor sai da região de novo"),
                A("WaitText", a => { Regiao(a); a.WaitMode = "disappears"; a.ConditionOperator = "contains"; a.ConditionOperand = "AGUARDE"; a.Timeout = 5000; a.Comment = "Some: espera AGUARDE sumir"; }),
                A("WaitText", a => { Regiao(a); a.WaitMode = "changes"; a.Timeout = 8000; a.WaitImageOnTimeout = "Continue"; a.Comment = "Muda: espera a região mostrar outra coisa, até 8 s"; }),
                Tecla("Ctrl+End", "fim do texto"),
                Txt("{enter}Fim: a tela mudou, ou o timeout seguiu.{enter}"))),

        new("29 · Cor de um ponto", "🎨",
            "Pixel color olha um ponto só da tela. A macro põe o Bloco de Notas num lugar fixo e abre uma aba nova; o ponto cai no fundo vazio dela: branco no tema claro, escuro no escuro. Wait Pixel Color espera o ponto ficar (Tem a cor) ou deixar (Perde a cor) de uma cor; aqui nada muda, então uma das esperas leva os 3 s e segue (Se der timeout: Continuar).",
            "condicionais", L(Colocar(), AbaNova(),
                Cond("If", "PixelColorMatch", a => { a.PixelX = PontoX; a.PixelY = PontoY; a.PixelColor = "#FFFFFF"; a.PixelTolerance = 10; }, "o ponto é branco, com tolerância de 10 por canal?"),
                Txt("{enter}O fundo é branco: o Bloco de Notas está no tema claro.{enter}"),
                Else(),
                Txt("{enter}O fundo não é branco: o Bloco de Notas está no tema escuro.{enter}"),
                EndIf(),
                A("WaitPixelColor", a => { a.PixelX = PontoX; a.PixelY = PontoY; a.PixelColor = "#FFFFFF"; a.PixelTolerance = 10; a.Timeout = 3000; a.PixelOnTimeout = "Continue"; a.Comment = "Tem a cor: no tema claro passa na hora"; }),
                A("WaitPixelColor", a => { a.PixelX = PontoX; a.PixelY = PontoY; a.PixelColor = "#FFFFFF"; a.PixelTolerance = 10; a.PixelInvert = true; a.Timeout = 3000; a.PixelOnTimeout = "Continue"; a.Comment = "Perde a cor: no tema escuro passa na hora"; }),
                Txt("As duas esperas terminaram.{enter}"))),

        new("30 · Imagem na tela", "🖼️",
            "Image found procura uma imagem de referência numa região. Aqui ela é a borda de uma fileira de blocos █ que a macro digita: meio branca, meio preta. A busca compara a forma, não a cor exata, e acha a borda nos dois temas. Wait Image espera a imagem aparecer (e clica nela) ou sumir. Para procurar algo seu, Recapturar no Inspector.",
            "condicionais", L(Colocar(), AbaNova(),
                Txt("{enter:8}Alvo:   ████████{enter}", "8 blocos cheios, dentro da região: a imagem é a borda deles"),
                Cond("If", "ImageFound", a => { a.ImagePath = Borda; a.Confidence = 0.8; Regiao(a); }, "Image found na região, com Tolerância de 80 %"),
                Txt("Achei a borda dos blocos.{enter}"),
                Else(),
                Txt("Não achei a borda dos blocos.{enter}"),
                EndIf(),
                A("WaitImage", a => { a.ImagePath = Borda; a.Confidence = 0.8; Regiao(a); a.Timeout = 3000; a.WaitImageClickOnMatch = true; a.Comment = "Aparece, e Clicar onde encontrar: clica na borda"; }),
                Tecla("Home", "o clique deixou o cursor na linha dos blocos: vai ao começo dela"),
                Tecla("Shift+End", "seleciona a linha dos blocos"),
                Tecla("Delete", "apaga os blocos"),
                A("WaitImage", a => { a.ImagePath = Borda; a.Confidence = 0.8; Regiao(a); a.Timeout = 3000; a.WaitImageInvert = true; a.Comment = "Some: espera a borda sumir"; }),
                Tecla("Ctrl+End", "fim do texto"),
                Txt("A borda sumiu.{enter}")),
            Images: new() { [Borda] = BordaPng() }),

        new("31 · Página na web", "🌐",
            "Browser element pergunta à extensão do navegador por um elemento da página, pelo seletor CSS: Visível, Ausente / oculto, Habilitado ou Texto corresponde. O primeiro If só passa com a extensão conectada e uma página aberta; aí Open URL abre example.com numa guia nova, Wait Element espera o título, Assert Element exige o link e os outros If conferem a página. Sem a extensão, a macro cai no Else.",
            "condicionais", L(Abrir(),
                Cond("If", "BrowserElementState", a => { a.Key = "body"; a.WaitMode = "appears"; }, "Visível: a extensão responde e há uma página aberta"),
                A("BrowserNavigate", a => { a.Key = "https://example.com"; a.NewTab = true; a.Comment = "Open URL, Abrir em nova guia"; }),
                A("BrowserWaitElement", a => { a.Key = "h1"; a.Timeout = 10000; a.Comment = "Wait Element: espera o título da página, até 10 s"; }),
                A("BrowserAssert", a => { a.Key = "a"; a.Comment = "Assert Element: exige o link (Se falhar: Parar)"; }),
                Abrir("de volta ao Bloco de Notas: a extensão confere a página sem o navegador na frente"),
                Cond("If", "BrowserElementState", a => { a.Key = "h1"; a.WaitMode = "text-match"; a.BrowserText = "text*=Example"; }, "Texto corresponde: o título contém Example"),
                Txt("{enter}A página abriu, e o título tem a palavra Example.{enter}"),
                EndIf(),
                Cond("If", "BrowserElementState", a => { a.Key = "a"; a.WaitMode = "enabled"; }, "Habilitado: o link pode ser clicado"),
                Txt("O link está habilitado.{enter}"),
                EndIf(),
                Cond("If", "BrowserElementState", a => { a.Key = "input"; a.WaitMode = "disappears"; }, "Ausente / oculto: a página não tem campo de texto"),
                Txt("E não há nenhum campo de texto.{enter}{enter}"),
                EndIf(),
                Else(),
                Txt("{enter}Sem a extensão conectada (ou numa guia sem página), o If cai no Else.{enter}{enter}"),
                EndIf())),

        // ══ Sistemas completos ═════════════════════════════════════════════════════════
        new("17 · Planilha que decide", "📊",
            "A tabela vem dentro da macro, na aba Data Loop. For Each Data Row repete o miolo uma vez por linha, e o If decide por linha. A Carla, sem @ no e-mail, cai no primeiro If (Não atendida), e o Next iteration passa para a próxima linha.",
            "completo", L(Abrir(),
                Txt("{enter}Clientes de {date}:{enter}", "roda 1×"),
                A("ForEachRow", a => a.Comment = "uma volta por linha da tabela"),
                Var("email", "{row:email}"),
                A("If", a => { a.ConditionType = "Variable"; a.Key = "email"; a.ConditionOperator = "contains"; a.ConditionOperand = "@"; a.ConditionNegate = true; a.Comment = "Passa com a condição Não atendida: e-mail sem @"; }),
                Txt("{datarow}. {row:nome} — e-mail inválido, linha pulada{enter}"),
                A("ContinueLoop", a => a.Comment = "Next iteration: vai para a próxima linha"),
                EndIf(),
                Var("plano", "{row:plano}"),
                CondVar("If", "plano", "eq", "Premium", "decide pela coluna plano"),
                Txt("{datarow}. {row:nome} — Premium: enviar brinde para {row:email}{enter}"),
                Else(),
                Txt("{datarow}. {row:nome} — plano básico{enter}"),
                EndIf(),
                EndLoop("fecha o For Each"),
                Txt("Fim da lista.{enter}{enter}", "roda 1×")),
            Data: new TrueReplayer.Models.ProfileDataTable
            {
                Headers = new() { "nome", "email", "plano" },
                Rows = new()
                {
                    new() { "Ana", "ana@exemplo.com", "Premium" },
                    new() { "Bruno", "bruno@exemplo.com", "Básico" },
                    new() { "Carla", "carla-sem-arroba", "Premium" },
                    new() { "Davi", "davi@exemplo.com", "Básico" },
                },
                // Loop over data DESLIGADO: o For Each e que percorre a tabela. O aviso de "lista
                // completa" do modo cursor fica desligado — ele contaria execucoes, nao o For Each.
                LoopOverData = false,
                NotifyOnLapComplete = false,
            }),

        new("18 · Atendimento completo", "🏁",
            "Junta tudo: perguntas, rodízio, {clipboard:next} num While, escada de If, contador, Assert de limite e uma macro chamada pelo Run Macro (18b), que lê as variáveis desta e devolve a execução para cá. A 1ª linha copiada é o lote: ela muda a cada execução, e é isso que faz o {clipboard:next} recomeçar — copiar a mesma coisa não recomeça.",
            "completo", L(Abrir(),
                Copia("Lote {time}{enter}PED-101{enter}PED-102{enter}PED-103", 4, "o lote e 3 pedidos"),
                Var("atendente", "{input:Seu nome}"),
                Var("motivo", "{input:Motivo|menu:Troca,Devolução,Dúvida}"),
                Var("saudacao", "Olá\nOi\nBom dia", "rodízio: uma saudação por execução", "cycle"),
                Var("lote", "{clipboard:next}", "1ª linha do clipboard: o lote"),
                Txt("{enter}Atendendo o {var:lote}:{enter}"),
                Var("pedido", "{clipboard:next}", "próxima linha: o 1º pedido"),
                A("While", a => { a.ConditionType = "Variable"; a.Key = "pedido"; a.ConditionOperator = "neq"; a.ConditionOperand = ""; a.LoopMaxIterations = 10; a.Comment = "enquanto houver pedido"; }),
                Var("n", "1", "conta os pedidos", "add"),
                Cond("Assert", "Variable", a => { a.Key = "n"; a.ConditionOperator = "lt"; a.ConditionOperand = "5"; }, "no máximo 4 pedidos por lote"),
                CondVar("If", "motivo", "eq", "Troca"),
                Txt("{var:saudacao}! Pedido {var:pedido}: troca aprovada.{enter}"),
                CondVar("ElseIf", "motivo", "eq", "Devolução"),
                Txt("{var:saudacao}! Pedido {var:pedido}: devolução em andamento.{enter}"),
                Else(),
                Txt("{var:saudacao}! Pedido {var:pedido}: dúvida registrada.{enter}"),
                EndIf(),
                Var("pedido", "{clipboard:next}", "a próxima; no fim vira vazio e o While sai"),
                EndLoop(),
                Txt("{var:n} pedidos atendidos.{enter}"),
                A("RunProfile", a => { a.Key = "18b · Assinatura"; a.RepeatCount = 1; a.Comment = "a macro chamada lê {var:atendente}"; }),
                Txt("De volta à 18: lote encerrado.{enter}{enter}", "a 18b terminou (ou deu Return) e a execução voltou para cá"))),

        new("18b · Assinatura", "✍️",
            "Macro chamada pelo Run Macro da 18. Roda dentro da mesma execução, então lê as variáveis de quem chamou. Sem o nome do atendente (rodada sozinha, ou com o nome em branco na 18), o Return encerra a 18b ali e devolve a execução a quem a chamou.",
            "completo", L(Abrir(),
                CondVar("If", "atendente", "eq", "", "sem nome do atendente?"),
                Txt("— (sem atendente){enter}", "rodada sozinha, ou nome em branco"),
                A("Return", a => a.Comment = "Return: volta para a macro que chamou"),
                EndIf(),
                Txt("— {var:atendente}, {date}{enter}", "{var:atendente} vem da macro 18"))),
    };

    // ── PNG minimo (deterministico) ─────────────────────────────────────────────────────
    static byte[] Png(int w, int h, Func<int, int, byte> cinza)
    {
        var raw = new MemoryStream();
        for (int y = 0; y < h; y++)
        {
            raw.WriteByte(0); // filtro None
            for (int x = 0; x < w; x++) { var v = cinza(x, y); raw.WriteByte(v); raw.WriteByte(v); raw.WriteByte(v); }
        }
        var z = new MemoryStream();
        using (var zs = new ZLibStream(z, CompressionLevel.SmallestSize, leaveOpen: true)) zs.Write(raw.ToArray());
        var png = new MemoryStream();
        png.Write(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
        void Chunk(string tipo, byte[] dados)
        {
            var t = System.Text.Encoding.ASCII.GetBytes(tipo);
            var len = BitConverter.GetBytes(dados.Length); if (BitConverter.IsLittleEndian) Array.Reverse(len);
            png.Write(len); png.Write(t); png.Write(dados);
            var crc = BitConverter.GetBytes(Crc32(t.Concat(dados).ToArray())); if (BitConverter.IsLittleEndian) Array.Reverse(crc);
            png.Write(crc);
        }
        var ihdr = new byte[13];
        void U32(byte[] b, int at, int v) { b[at] = (byte)(v >> 24); b[at + 1] = (byte)(v >> 16); b[at + 2] = (byte)(v >> 8); b[at + 3] = (byte)v; }
        U32(ihdr, 0, w); U32(ihdr, 4, h); ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
        Chunk("IHDR", ihdr);
        Chunk("IDAT", z.ToArray());
        Chunk("IEND", Array.Empty<byte>());
        return png.ToArray();
    }
    static uint Crc32(byte[] data)
    {
        uint c = 0xFFFFFFFF;
        foreach (var b in data)
        {
            c ^= b;
            for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
        }
        return c ^ 0xFFFFFFFF;
    }

    // ── conferencia de tokens pelo resolvedor do proprio app ─────────────────────────────
    static Type? RunCtxT; static MethodInfo? ResolveM;
    static object Ctx(Dictionary<string, string>? vars = null, int iteration = 1, int loop = 0, int dataRow = 0, Dictionary<string, string>? row = null,
                      int step = 0, TrueReplayer.Models.ProfileDataTable? table = null, Dictionary<string, int>? rowNext = null, Dictionary<string, string>? slots = null)
    {
        var ctx = Activator.CreateInstance(RunCtxT!)!;
        var f = BindingFlags.NonPublic | BindingFlags.Instance;
        if (vars != null) RunCtxT!.GetField("<Variables>k__BackingField", f)!.SetValue(ctx, new Dictionary<string, string>(vars, StringComparer.OrdinalIgnoreCase));
        if (row != null) RunCtxT!.GetField("<RowData>k__BackingField", f)!.SetValue(ctx, new Dictionary<string, string>(row, StringComparer.OrdinalIgnoreCase));
        RunCtxT!.GetField("<Iteration>k__BackingField", f)!.SetValue(ctx, iteration);
        RunCtxT!.GetField("<Loop>k__BackingField", f)!.SetValue(ctx, loop);
        RunCtxT!.GetField("<DataRow>k__BackingField", f)!.SetValue(ctx, dataRow);
        RunCtxT!.GetField("<Row>k__BackingField", f)!.SetValue(ctx, step);
        if (table != null) RunCtxT!.GetField("<DataTable>k__BackingField", f)!.SetValue(ctx, table);
        if (rowNext != null) RunCtxT!.GetField("<RowNextCursors>k__BackingField", f)!.SetValue(ctx, rowNext);
        if (slots != null) RunCtxT!.GetField("<ClipSlots>k__BackingField", f)!.SetValue(ctx, new Dictionary<string, string>(slots, StringComparer.OrdinalIgnoreCase));
        return ctx;
    }
    static async Task<string> Resolve(string text, string? clip, object ctx)
        => await (Task<string>)ResolveM!.Invoke(null, new object?[] { text, null, ctx, clip, false, false, null })!;

    static int pass, fail;
    static async Task Check(string name, string text, string? clip, object ctx, string want)
    {
        string got; try { got = await Resolve(text, clip, ctx); } catch (Exception ex) { got = "EXCEPTION " + (ex.InnerException ?? ex).Message; }
        bool ok = want.StartsWith("re:") ? Regex.IsMatch(got, want[3..]) : got == want;
        if (ok) pass++; else fail++;
        Console.WriteLine($"  {(ok ? "OK  " : "FAIL")} {name}: \"{got.Replace("\n", "⏎")}\"{(ok ? "" : "  (esperado " + want + ")")}");
    }

    public static async Task<int> Run(string dir, string outFile)
    {
        var dll = Path.Combine(dir, "TrueReplayer.dll");
        var fvi = System.Diagnostics.FileVersionInfo.GetVersionInfo(dll);
        Console.WriteLine($"DLL: {dll}\nProductVersion: {fvi.ProductVersion}\n");
        var exs = Exemplos();
        int problemas = 0;

        // 1) cada perfil: blocos bem formados + versao minima + imagens que ele cita
        // Deterministico: data fixa e ids derivados do perfil + posicao, para regerar sem diff.
        var agora = new DateTime(2026, 9, 22, 12, 0, 0, DateTimeKind.Utc);
        var envelope = new TrueReplayer.Models.ProfileExportEnvelope { Version = 1, ExportedAt = agora.ToString("o") };
        foreach (var e in exs)
            for (int i = 0; i < e.Actions.Count; i++)
                e.Actions[i].Id = Convert.ToHexString(System.Security.Cryptography.MD5.HashData(
                    System.Text.Encoding.UTF8.GetBytes($"truereplayer-exemplo|{e.Name}|{i}"))).ToLowerInvariant();
        var nomes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Console.WriteLine("PERFIS");
        foreach (var e in exs)
        {
            var copia = e.Actions.Select(a => a).ToList();
            var v = TrueReplayer.Services.ConditionalBlockValidator.ValidateAndRepairBlocks(copia);
            var up = new TrueReplayer.Models.UserProfile
            {
                Actions = new ObservableCollection<TrueReplayer.Models.ActionItem>(e.Actions),
                EnableLoop = e.Loops > 1, LoopCount = e.Loops, Data = e.Data,
            };
            var min = TrueReplayer.Services.ProfileCompatibility.ComputeMinVersion(up);
            bool nomeOk = TrueReplayer.Services.ProfileNameValidator.IsSafe(e.Name) && nomes.Add(e.Name);
            bool okBloco = v.OrphansRemoved == 0 && v.EndIfsAppended == 0 && copia.Count == e.Actions.Count;
            bool okDesc = e.Desc.Length <= 500;
            // Toda linha que cita uma imagem a leva no pacote (senao a importacao conta uma imagem perdida).
            var faltam = e.Actions.Where(a => !string.IsNullOrEmpty(a.ImagePath) && !(e.Images?.ContainsKey(a.ImagePath!) ?? false)).Select(a => a.ImagePath).ToList();
            bool okImg = faltam.Count == 0;
            if (!okBloco || !nomeOk || !okDesc || !okImg) problemas++;
            Console.WriteLine($"  {(okBloco && nomeOk && okDesc && okImg ? "OK  " : "FAIL")} {e.Name,-32} {e.Actions.Count,2} linhas  min {min ?? "-",-13} desc {e.Desc.Length,3}/500{(okBloco ? "" : $"  BLOCO orfaos={v.OrphansRemoved} endif+={v.EndIfsAppended}")}{(nomeOk ? "" : "  NOME INVALIDO OU REPETIDO")}{(okImg ? "" : "  IMAGEM FALTANDO " + string.Join(",", faltam))}");
            envelope.Profiles.Add(new TrueReplayer.Models.ProfileExportEntry
            {
                Name = e.Name, Actions = new ObservableCollection<TrueReplayer.Models.ActionItem>(e.Actions),
                EnableLoop = e.Loops > 1, LoopCount = e.Loops, Data = e.Data, Images = e.Images,
                Description = e.Desc, Tags = new List<string> { "exemplo", e.Tag }, IconEmoji = e.Emoji,
                CreatedAt = agora, UpdatedAt = agora, ProfileVersion = 1, AppMinVersion = min,
            });
        }
        envelope.Organization = new TrueReplayer.Models.ProfileExportOrganization
        {
            Folders = new() { new TrueReplayer.Models.ProfileFolder { Name = "Exemplos", Color = "#9B7BFF", Collapsed = false, Items = exs.Select(x => x.Name).ToList() } },
        };
        var porGrupo = exs.GroupBy(x => x.Tag).Select(g => $"{g.Key} {g.Count()}");
        Console.WriteLine($"\nGRUPOS: {string.Join(" · ", porGrupo)} · total {exs.Count}");

        // 2) serializa como a exportacao do app e rele com o parser do import
        var opts = new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase, TypeInfoResolver = new DefaultJsonTypeInfoResolver() };
        var json = JsonSerializer.Serialize(envelope, opts);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outFile))!);
        File.WriteAllText(outFile, json);
        var (env2, err) = TrueReplayer.Controllers.ProfileController.ParseImportEnvelope(json);
        bool parseOk = err == TrueReplayer.Controllers.ImportParseError.None && env2 != null && env2.Profiles.Count == exs.Count
                       && env2.Organization?.Folders.Count == 1 && env2.Organization.Folders[0].Items.Count == exs.Count;
        if (!parseOk) problemas++;
        var running = fvi.ProductVersion?.Split('+')[0] ?? "0.0.0";
        var incompat = env2?.Profiles.Where(p => !TrueReplayer.Services.ProfileCompatibility.IsCompatible(p.AppMinVersion, running)).Select(p => p.Name).ToList() ?? new();
        if (incompat.Count > 0) problemas++;
        Console.WriteLine($"\nPACOTE: {new FileInfo(outFile).Length / 1024} KB · parser do import: {err} · {env2?.Profiles.Count} perfis · pasta '{env2?.Organization?.Folders[0].Name}' com {env2?.Organization?.Folders[0].Items.Count} itens · incompatíveis com {running}: {incompat.Count}");
        var bordaPng = Convert.FromBase64String(BordaPng());
        Console.WriteLine($"IMAGEM {Borda}: {bordaPng.Length} bytes, PNG {(bordaPng.Take(8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }) ? "ok" : "INVALIDO")}");

        // 3) saidas citadas, conferidas no resolvedor de tokens
        var rep = typeof(TrueReplayer.Services.ActionReplayer);
        RunCtxT = rep.GetNestedType("RunCtx", BindingFlags.Public | BindingFlags.NonPublic)!;
        ResolveM = rep.GetMethod("ResolveTokensAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
        Console.WriteLine("\nTOKENS");
        var c = Ctx();
        // 02
        await Check("02 +7 dias", "{date:+7:dd/MM/yyyy}", null, c, DateTime.Now.AddDays(7).ToString("dd/MM/yyyy"));
        await Check("02 +2w", "{date:+2w:dd/MM}", null, c, DateTime.Now.AddDays(14).ToString("dd/MM"));
        await Check("02 +1y", "{date:+1y:yyyy}", null, c, DateTime.Now.AddYears(1).ToString("yyyy"));
        await Check("02 ontem (dddd)", "{date:-1:dddd}", null, c, "re:.+");
        await Check("02 +1mo (MMMM)", "{date:+1mo:MMMM}", null, c, "re:^\\p{L}+$");
        await Check("02 +1h+30min", "{time:+1h:+30min:HH:mm}", null, c, DateTime.Now.AddMinutes(90).ToString("HH:mm"));
        await Check("02 +45s", "{time:+45s:HH:mm:ss}", null, c, "re:^\\d\\d:\\d\\d:\\d\\d$");
        await Check("02 date e time", "{date} — {time}", null, c, "re:^\\d\\d/\\d\\d/\\d{4} — \\d\\d:\\d\\d:\\d\\d$");
        await Check("02 datetime", "{datetime}", null, c, "re:^\\d\\d/\\d\\d/\\d{4} - \\d\\d:\\d\\d:\\d\\d$");
        await Check("02 D (longa)", "{date:D}", null, c, "re:\\d{4}");
        // 03
        await Check("03 pick", "{Pick:Olá|Oi|Bom dia}", null, c, "re:^(Olá|Oi|Bom dia)$");
        await Check("03 random", "{random:1-60}", null, c, "re:^([1-9]|[1-5][0-9]|60)$");
        // 04
        const string nome04 = "  maria JOSÉ pereira  ";
        await Check("04 como veio", "[{clipboard}]", nome04, c, "[  maria JOSÉ pereira  ]");
        await Check("04 trim:lower:title", "{clipboard:trim:lower:title}", nome04, c, "Maria José Pereira");
        await Check("04 trim:noaccents:upper", "{clipboard:trim:noaccents:upper}", nome04, c, "MARIA JOSE PEREIRA");
        await Check("04 digits", "{clipboard:digits}", "+55 (11) 98888-7777", c, "5511988887777");
        await Check("04 replace", "{clipboard:replace:(11):(21)}", "+55 (11) 98888-7777", c, "+55 (21) 98888-7777");
        // 05 (e com CRLF, que é como o Bloco de Notas copia)
        var cad = "Maria Souza\nmaria@email.com\nVendedor - 2x Caixa Rara";
        foreach (var (rot, txt) in new[] { ("", cad), (" (CRLF)", cad.Replace("\n", "\r\n")) })
        {
            await Check("05 line:2" + rot, "{clipboard:line:2}", txt, c, "maria@email.com");
            await Check("05 word:1" + rot, "{clipboard:word:1}", txt, c, "Maria");
            await Check("05 words:1-2" + rot, "{clipboard:words:1-2}", txt, c, "Maria Souza");
            await Check("05 before:@" + rot, "{clipboard:line:2:before:@}", txt, c, "maria");
            await Check("05 beforelast:." + rot, "{clipboard:line:2:beforelast:.}", txt, c, "maria@email");
            await Check("05 afterlast:." + rot, "{clipboard:line:2:afterlast:.}", txt, c, "com");
            await Check("05 after" + rot, "{clipboard:line:3:after: - }", txt, c, "2x Caixa Rara");
            await Check("05 after+dropnum" + rot, "{clipboard:line:3:after: - :dropnum:x }", txt, c, "Caixa Rara");
            await Check("05 first:5" + rot, "{clipboard:line:2:first:5}", txt, c, "maria");
            await Check("05 last:4" + rot, "{clipboard:line:2:last:4}", txt, c, ".com");
            await Check("05 default" + rot, "{clipboard:line:4:default:(não tem)}", txt, c, "(não tem)");
        }
        // 06
        var fr = "banana\nmaçã\nbanana\nabacaxi";
        foreach (var (rot, txt) in new[] { ("", fr), (" (CRLF)", fr.Replace("\n", "\r\n")) })
        {
            await Check("06 sort:dedupe:join:sentence" + rot, "{clipboard:sort:dedupe:join:, :sentence}", txt, c, "Abacaxi, banana, maçã");
            await Check("06 dedupe:count" + rot, "{clipboard:dedupe:count}", txt, c, "3");
            await Check("06 reverse:join" + rot, "{clipboard:reverse:join: / }", txt, c, "abacaxi / banana / maçã / banana");
            await Check("06 range:2-3" + rot, "{clipboard:range:2-3:join: e }", txt, c, "maçã e banana");
            await Check("06 lines:4,1" + rot, "{clipboard:lines:4,1:join:, }", txt, c, "abacaxi, banana");
        }
        // 07, 09, 11
        await Check("07 valor guardado", "{clipboard:trim:title}", "  joão carvalho  ", c, "João Carvalho");
        await Check("07 var:upper", "{var:cliente:upper}", null, Ctx(new() { ["cliente"] = "João Carvalho" }), "JOÃO CARVALHO");
        await Check("09 counter:pad:3 (volta 2)", "Item {counter:pad:3} — total: {var:total}", null, Ctx(new() { ["total"] = "20" }, iteration: 2), "Item 002 — total: 20");
        var ls = new Dictionary<string, string> { ["lista"] = "Ana\nBia\nCaio", ["i"] = "2" };
        await Check("11 volta 1", "Volta {counter}: {var:lista:line:@counter} — e a {var:i}ª é sempre {var:lista:line:@i}", null, Ctx(ls, iteration: 1), "Volta 1: Ana — e a 2ª é sempre Bia");
        await Check("11 volta 3", "{var:lista:line:@counter}", null, Ctx(ls, iteration: 3), "Caio");
        await Check("11 {row} e @row (passo 5)", "Este é o passo {row}; a {row}ª linha da lista: {var:lista:line:@row:default:não há}", null, Ctx(ls, step: 5), "Este é o passo 5; a 5ª linha da lista: não há");
        // 15, 24
        await Check("15 volta", "Volta {loop}: i = {var:i}", null, Ctx(new() { ["i"] = "4" }, loop: 4), "Volta 4: i = 4");
        var fila = new Dictionary<string, string> { ["fila"] = "Ana\nBia\nCaio\nDavi" };
        await Check("24 count", "{var:fila:count} nomes", null, Ctx(fila), "4 nomes");
        await Check("24 line:@loop (volta 2)", "{var:fila:line:@loop}", null, Ctx(fila, loop: 2), "Bia");
        await Check("24 line:@loop (volta 5: vazio)", "[{var:fila:line:@loop}]", null, Ctx(fila, loop: 5), "[]");
        await Check("24 loop:pad:2", "{loop:pad:2}. {var:nome}", null, Ctx(new() { ["nome"] = "Caio" }, loop: 3), "03. Caio");
        // 14, 18, 18b
        await Check("14 caminho com env", "{env:WINDIR}\\notepad.exe", null, c, "re:(?i)^[a-z]:\\\\windows\\\\notepad\\.exe$");
        await Check("18 lote", "Lote {time}", null, c, "re:^Lote .+");
        await Check("18b assinatura", "— {var:atendente}", null, Ctx(new() { ["atendente"] = "Rita" }), "— Rita");
        // 17, 22, 23
        await Check("17 linha de dados", "{datarow}. {row:nome} — Premium: enviar brinde para {row:email}", null,
            Ctx(dataRow: 1, row: new() { ["nome"] = "Ana", ["email"] = "ana@exemplo.com", ["plano"] = "Premium" }), "1. Ana — Premium: enviar brinde para ana@exemplo.com");
        var t22 = exs.First(x => x.Name.StartsWith("22 ")).Data!;
        await Check("22 linha da vez (2)", "Linha {datarow:pad:2} de 3: {row:nome}, de {row:cidade:title}, pedido nº {row:pedido:pad:4}", null,
            Ctx(dataRow: 2, row: new() { ["nome"] = "Bruno", ["cidade"] = "curitiba", ["pedido"] = "12" }, table: t22), "Linha 02 de 3: Bruno, de Curitiba, pedido nº 0012");
        await Check("22 rownext ×3", "{rownext:nome} ({rownext:cidade:title}), {rownext:nome} ({rownext:cidade:title}) e {rownext:nome} ({rownext:cidade:title})", null,
            Ctx(table: t22, rowNext: new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)), "Ana (São Paulo), Bruno (Curitiba) e Carla (Belo Horizonte)");
        var t23 = exs.First(x => x.Name.StartsWith("23 ")).Data!;
        await Check("23 linha 2 com @datarow", "{datarow}. {row:produto} — R$ {row:preco} — brinde: {var:brindes:line:@datarow}", null,
            Ctx(new() { ["brindes"] = "chaveiro\nadesivo\nboné" }, dataRow: 2, row: new() { ["produto"] = "Caneta", ["preco"] = "4" }, table: t23), "2. Caneta — R$ 4 — brinde: adesivo");
        // 20
        await Check("20 env", "{env:USERNAME} · {env:COMPUTERNAME:lower}", null, c, $"{Environment.GetEnvironmentVariable("USERNAME")} · {Environment.GetEnvironmentVariable("COMPUTERNAME")?.ToLowerInvariant()}");
        await Check("20 timestamp", "{timestamp}", null, c, "re:^\\d{10}$");
        await Check("20 timestamp:ms", "{timestamp:ms}", null, c, "re:^\\d{13}$");
        await Check("20 timestamp:last:4", "{timestamp:last:4}", null, c, "re:^\\d{4}$");
        await Check("20 uuid", "{uuid}", null, c, "re:^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
        await Check("20 uuid:first:8:upper", "{uuid:first:8:upper}", null, c, "re:^[0-9A-F]{8}$");
        var dois = await Resolve("{uuid}|{uuid}", null, c);
        bool doisOk = dois.Split('|') is var p && p.Length == 2 && p[0] != p[1];
        if (doisOk) pass++; else fail++;
        Console.WriteLine($"  {(doisOk ? "OK  " : "FAIL")} 20 cada {{uuid}} é outro: {dois}");
        // 21: o slot e o default do slot vazio (o histórico do Win+V é da máquina: não entra aqui)
        await Check("21 slot", "{clip:nota:upper}", null, Ctx(slots: new() { ["nota"] = "Nota 123" }), "NOTA 123");
        await Check("21 slot vazio", "{clip:nota:default:(vazio)}", null, Ctx(slots: new()), "(vazio)");
        // 18: a sequencia do {clipboard:next} com o cursor vivo, como no replay.
        var lote = "Lote 18:00:00\r\nPED-101\r\nPED-102\r\nPED-103";
        var cur = Ctx();
        RunCtxT!.GetField("<ClipNextCursors>k__BackingField", BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(cur, new Dictionary<string, int>());
        var seq = new List<string>();
        for (int k = 0; k < 5; k++) seq.Add(await Resolve("{clipboard:next}", lote, cur));
        bool seqOk = string.Join("|", seq) == "Lote 18:00:00|PED-101|PED-102|PED-103|";
        if (seqOk) pass++; else fail++;
        Console.WriteLine($"  {(seqOk ? "OK  " : "FAIL")} 18 clipboard:next ×5: {string.Join(" | ", seq.Select(x => x.Length == 0 ? "(vazio)" : x))}");
        var mesmo = await Resolve("{clipboard:next}", lote, cur);
        var outro = await Resolve("{clipboard:next}", lote.Replace("18:00:00", "18:00:05"), cur);
        bool reOk = mesmo == "" && outro == "Lote 18:00:05";
        if (reOk) pass++; else fail++;
        Console.WriteLine($"  {(reOk ? "OK  " : "FAIL")} 18 mesmo texto não recomeça (\"{mesmo}\"), outro texto recomeça (\"{outro}\")");
        Console.WriteLine($"  regex do 14 casa 11 dígitos:{Regex.IsMatch("12345678901", "^\\d{11}$")} · não casa 10: {!Regex.IsMatch("1234567890", "^\\d{11}$")}");
        Console.WriteLine($"  regex do 27 casa 'PEDIDO 4521': {Regex.IsMatch("PEDIDO 4521 APROVADO", "PEDIDO \\d{4}", RegexOptions.IgnoreCase)}");
        Console.WriteLine($"  arquivo do 14 existe nesta máquina: {File.Exists(Environment.ExpandEnvironmentVariables("%WINDIR%\\notepad.exe"))}");

        Console.WriteLine($"\nRESULTADO: perfis/pacote com problema: {problemas} · tokens {pass} ok / {fail} falha");
        return problemas == 0 && fail == 0 ? 0 : 1;
    }
}
