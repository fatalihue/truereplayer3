// Gera o pacote de exemplos (TrueReplayer-exemplos.trprofile) com os tipos REAIS do app, valida cada
// perfil e confere no resolvedor de tokens as saidas que o manual cita. O mesmo pacote vai em dois
// lugares: Examples\ deste repo, embutido no app ("Use this example"), e docs\exemplos\ do repo
// TrueReplayer-releases, para baixar pelo manual.
//   1. na raiz do repo: dotnet build TrueReplayer.csproj -c Release -p:Platform=x64
//   2. dotnet build tools\ExampleProfiles -c Release
//   3. cd bin\x64\Release\net8.0-windows10.0.19041.0\win-x64
//      dotnet <repo>\tools\ExampleProfiles\bin\Release\net8.0-windows10.0.19041.0\win-x64\exgen.dll . <saida.trprofile>
// Rodar com o diretorio atual na pasta do build: o WindowsAppSDK procura as DLLs nativas ali.
using System.Collections.ObjectModel;
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
              int Loops = 1, TrueReplayer.Models.ProfileDataTable? Data = null);

    // Atraso de cada linha = o que a UI da a uma linha inserida (CustomDelay padrao, 100 ms);
    // marcadores puros ficam em 0, que e o que o ConditionalBlockValidator normaliza no load.
    static readonly HashSet<string> Marcadores = new() { "Else", "EndIf", "EndLoop", "BreakLoop", "ContinueLoop", "ForEachRow" };
    static TrueReplayer.Models.ActionItem A(string type, Action<TrueReplayer.Models.ActionItem>? cfg = null)
    { var a = new TrueReplayer.Models.ActionItem { ActionType = type, Delay = Marcadores.Contains(type) ? 0 : 100 }; cfg?.Invoke(a); return a; }

    // ── blocos de montagem ─────────────────────────────────────────────────────────────
    static TrueReplayer.Models.ActionItem Abrir() => A("ActivateWindow", a =>
    { a.WindowProcessName = "notepad"; a.LaunchPath = "notepad.exe"; a.Timeout = 5000; a.Comment = "abre o Bloco de Notas, ou traz para a frente"; });
    static TrueReplayer.Models.ActionItem Txt(string t, string note = "") => A("SendText", a => { a.Key = t; a.Comment = note; });
    static TrueReplayer.Models.ActionItem Digita(string t, string note) => A("SendText", a => { a.Key = t; a.SendMethod = "type"; a.Comment = note; });
    static TrueReplayer.Models.ActionItem Tecla(string k, string note = "", int vezes = 1) => A("Keystroke", a => { a.Key = k; a.RepeatCount = vezes; a.Comment = note; });
    static TrueReplayer.Models.ActionItem Var(string nome, string valor, string note = "", string? modo = null) =>
        A("SetVariable", a => { a.Key = nome; a.VariableValue = valor; a.VariableMode = modo; a.Comment = note; });
    static TrueReplayer.Models.ActionItem CondVar(string tipo, string nome, string op, string valor, string note = "") =>
        A(tipo, a => { a.ConditionType = "Variable"; a.Key = nome; a.ConditionOperator = op; a.ConditionOperand = valor; a.Comment = note; });
    static TrueReplayer.Models.ActionItem Cond(string tipo, string ct, Action<TrueReplayer.Models.ActionItem> cfg, string note = "") =>
        A(tipo, a => { a.ConditionType = ct; cfg(a); a.Comment = note; });
    static TrueReplayer.Models.ActionItem Else() => A("Else");
    static TrueReplayer.Models.ActionItem EndIf() => A("EndIf");
    static TrueReplayer.Models.ActionItem EndLoop(string note = "") => A("EndLoop", a => a.Comment = note);

    // Prepara a entrada: vai ao fim do texto, digita a amostra numa linha nova em modo Type (que
    // nao toca no clipboard), seleciona e copia. O Ctrl+End e o {enter} da frente garantem que a
    // selecao pega SO a amostra, mesmo que o cursor esteja no meio de um texto seu.
    static IEnumerable<TrueReplayer.Models.ActionItem> Copia(string amostra, int linhas, string oque)
    {
        yield return Tecla("Ctrl+End", "prepara: vai para o fim do texto");
        yield return Digita("{enter}" + amostra, "digita " + oque + " (modo Type, sem clipboard)");
        yield return Tecla("Shift+Home", "seleciona a linha");
        if (linhas > 1) yield return Tecla("Shift+Up", "estende a seleção às linhas de cima", linhas - 1);
        yield return Tecla("Ctrl+C", "copia");
        yield return Tecla("Ctrl+End", "sai da seleção, no fim do texto");
    }

    static List<TrueReplayer.Models.ActionItem> L(params object[] xs)
    {
        var l = new List<TrueReplayer.Models.ActionItem>();
        foreach (var x in xs)
            if (x is TrueReplayer.Models.ActionItem a) l.Add(a);
            else if (x is IEnumerable<TrueReplayer.Models.ActionItem> e) l.AddRange(e);
        return l;
    }

    static List<Ex> Exemplos() => new()
    {
        // ══ Tokens ══════════════════════════════════════════════════════════════════════
        new("01 · Olá com Enter", "👋",
            "Digita duas linhas no Bloco de Notas. {enter} e {tab} dentro do texto viram teclas de verdade. Selecione o perfil e aperte Replay.",
            "tokens", L(Abrir(),
                Txt("Olá! Tudo bem?{enter}Segue o código:{tab}ABC-123{enter}{enter}", "{enter} e {tab} são teclas, não texto"))),

        new("02 · Datas", "📅",
            "Datas e horas lidas na hora de rodar. Depois do nome vêm o deslocamento (+7 dias, -1 dia) e o formato (dd/MM/yyyy, dddd). Maiúsculas importam: MM é mês, mm é minuto.",
            "tokens", L(Abrir(),
                Txt("Hoje: {date} — agora: {time}{enter}", "data e hora de agora"),
                Txt("Daqui a 7 dias: {date:+7:dd/MM/yyyy}{enter}", "+7 dias, no formato pedido"),
                Txt("Ontem foi {date:-1:dddd}.{enter}{enter}", "dddd = nome do dia da semana"))),

        new("03 · Sorteio", "🎲",
            "{Pick:…} sorteia uma frase e {random:a-b} um número. Cada ocorrência sorteia a sua: rode duas vezes e compare.",
            "tokens", L(Abrir(),
                Txt("{Pick:Olá|Oi|Bom dia}! Seu número da sorte: {random:1-60}{enter}", "sorteia a frase e o número"),
                Txt("Dois dados: {random:1-6} e {random:1-6}{enter}{enter}", "cada {random} sorteia o seu"))),

        new("04 · Limpar o copiado", "🧹",
            "Digita uma amostra, copia e usa {clipboard} com modificadores. A ordem importa: trim limpa as pontas, lower baixa tudo, title capitaliza. Usa o seu clipboard.",
            "tokens", L(Abrir(),
                Copia("  maria SOUZA  ", 1, "um nome sujo"),
                Txt("{enter}Como veio: [{clipboard}]{enter}", "o clipboard cru, com os espaços"),
                Txt("Limpo: {clipboard:trim:lower:title}{enter}", "trim → lower → title"),
                Copia("+55 (11) 98888-7777", 1, "um telefone"),
                Txt("{enter}Só os dígitos: {clipboard:digits}{enter}{enter}", "digits mantém só 0–9"))),

        new("05 · Recortar", "✂️",
            "Recorta um pedaço do que foi copiado: uma linha, uma palavra, o que vem depois de um marcador. Os espaços do marcador contam: ' - ' não é '-'. Usa o seu clipboard.",
            "tokens", L(Abrir(),
                Copia("Maria Souza{enter}maria@email.com{enter}Vendedor - 2x Caixa Rara", 3, "um cadastro de 3 linhas"),
                Txt("{enter}Linha 2: {clipboard:line:2}{enter}", "só a 2ª linha"),
                Txt("1ª palavra: {clipboard:word:1}{enter}", "só a 1ª palavra"),
                Txt("Depois de ' - ': {clipboard:line:3:after: - }{enter}", "o marcador tem espaços dos dois lados"),
                Txt("Sem a quantidade: {clipboard:line:3:after: - :dropnum:x }{enter}{enter}", "dropnum tira o '2x '"))),

        new("06 · Listas", "📋",
            "Trata o clipboard como lista, uma linha por item: ordena, tira as repetidas, conta e junta numa frase. Usa o seu clipboard.",
            "tokens", L(Abrir(),
                Copia("banana{enter}maçã{enter}banana{enter}abacaxi", 4, "uma lista de 4 linhas"),
                Txt("{enter}Em ordem, sem repetidas: {clipboard:sort:dedupe:join:, }{enter}", "sort → dedupe → join"),
                Txt("Quantas diferentes: {clipboard:dedupe:count}{enter}", "count conta as linhas"),
                Txt("De trás para frente: {clipboard:reverse:join: / }{enter}{enter}", "reverse inverte a ordem"))),

        // ══ Variáveis ═══════════════════════════════════════════════════════════════════
        new("07 · Guardar e reusar", "💾",
            "Set Variable guarda um valor na hora. Ele fica fixo até o fim da execução, mesmo que o clipboard mude depois. Nomes: letras, números e _.",
            "variáveis", L(Abrir(),
                Copia("  joão pedro  ", 1, "um nome"),
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
            "O perfil roda 3 vezes (Loops = 3). {counter} é a volta; Set Variable em Add soma a cada volta, porque a variável dura a execução inteira.",
            "variáveis", L(Abrir(),
                Var("total", "10", "modo Add: soma 10 a cada volta", "add"),
                Txt("Item {counter:pad:3} — total: {var:total}{enter}", "pad:3 completa com zeros")), Loops: 3),

        new("10 · Rodízio", "🔁",
            "Set Variable em Cycle guarda o PRÓXIMO item da lista a cada execução e volta ao começo no fim. A posição fica gravada: rode várias vezes. Botão direito na linha → Reset cycle position recomeça.",
            "variáveis", L(Abrir(),
                Var("saudacao", "Bom dia\nOlá\nOi, tudo bem?", "modo Cycle: um item por linha", "cycle"),
                Txt("{var:saudacao} — esta execução pegou este.{enter}", "rode de novo: vem o próximo"))),

        new("11 · Número vindo de variável", "🎯",
            "Onde um modificador pede um número, @nome usa o valor de uma variável. @counter é reservado: a volta atual. Roda 3 vezes (Loops = 3).",
            "variáveis", L(Abrir(),
                Var("lista", "Ana\nBia\nCaio", "três nomes, um por linha"),
                Var("i", "2", "um número guardado"),
                Txt("Volta {counter}: {var:lista:line:@counter} — e a {var:i}ª é sempre {var:lista:line:@i}{enter}", "line:@counter e line:@i")), Loops: 3),

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
            "O If também pergunta ao Windows: janela aberta, processo rodando, hora do dia, arquivo existe, o que está no clipboard e uma moeda. As respostas mudam de máquina para máquina e de hora para hora.",
            "condicionais", L(Abrir(),
                Cond("If", "WindowOpen", a => a.WindowProcessName = "notepad", "Window Open: há janela do Bloco de Notas?"),
                Txt("{enter}O Bloco de Notas está aberto.{enter}"),
                EndIf(),
                Cond("If", "ProcessRunning", a => a.WindowProcessName = "chrome", "Process Running: o Chrome está rodando?"),
                Txt("O Chrome está rodando.{enter}"),
                Else(),
                Txt("O Chrome não está rodando.{enter}"),
                EndIf(),
                Cond("If", "TimeWindow", a => { a.TimeStart = "05:00"; a.TimeEnd = "12:00"; }, "Time: de manhã?"),
                Txt("Bom dia!{enter}"),
                Cond("ElseIf", "TimeWindow", a => { a.TimeStart = "12:00"; a.TimeEnd = "18:00"; }, "de tarde? (12:00 em ponto já ficou no de cima)"),
                Txt("Boa tarde!{enter}"),
                Else(),
                Txt("Boa noite!{enter}"),
                EndIf(),
                Cond("If", "FileExists", a => a.FilePath = "{env:WINDIR}\\notepad.exe", "File Exists: o caminho aceita tokens"),
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
            "While repete enquanto a condição vale; {loop} é a volta do bloco. Next iteration pula o resto da volta, Break loop sai do bloco. Max iterations (20) é o freio de emergência.",
            "condicionais", L(Abrir(),
                Var("i", "0", "começa do zero"),
                Txt("{enter}Contando:{enter}"),
                A("While", a => { a.ConditionType = "Variable"; a.Key = "i"; a.ConditionOperator = "lt"; a.ConditionOperand = "10"; a.LoopMaxIterations = 20; a.Comment = "enquanto i < 10"; }),
                Var("i", "1", "modo Add: i + 1", "add"),
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
            "Assert exige: se não valer, para com erro (Abort) ou encerra sem erro (Stop quietly). Return encerra só o passe; Stop, a execução inteira. Loops = 5, mas só 3 passes rodam. A pergunta vem uma vez: a resposta vale para a execução toda. Responda não para ver o Stop quietly.",
            "condicionais", L(Abrir(),
                Cond("Assert", "WindowOpen", a => { a.WindowProcessName = "notepad"; a.WindowMatchForegroundOnly = true; a.ConditionTimeout = 3000; }, "Bloco de Notas na frente"),
                Var("seguir", "{input:Continuar?|menu:sim,não}", "responda não para ver o Stop quietly"),
                Cond("Assert", "Variable", a => { a.Key = "seguir"; a.ConditionOperator = "eq"; a.ConditionOperand = "sim"; a.AssertOnFail = "StopReplay"; }, "você escolheu não seguir"),
                Var("passe", "{counter}", "o número do passe"),
                Txt("Passe {counter}: "),
                CondVar("If", "passe", "eq", "2"),
                Txt("Return encerra só este passe.{enter}"),
                A("Return", a => a.Comment = "Return: o próximo passe roda"),
                EndIf(),
                CondVar("If", "passe", "eq", "3"),
                Txt("Stop encerra a execução inteira.{enter}{enter}"),
                A("Stop", a => a.Comment = "Stop: os passes 4 e 5 nunca rodam"),
                EndIf(),
                Txt("segue normal.{enter}")), Loops: 5),

        // ══ Sistemas completos ═════════════════════════════════════════════════════════
        new("17 · Planilha que decide", "📊",
            "A tabela vem dentro do perfil: ícone de tabela na barra. For Each Data Row repete o miolo uma vez por linha, e o If decide por linha. A Carla, sem @ no e-mail, cai no primeiro If (NOT Met), e o Next iteration passa para a próxima linha.",
            "completo", L(Abrir(),
                Txt("{enter}Clientes de {date}:{enter}", "roda 1×"),
                A("ForEachRow", a => a.Comment = "uma volta por linha da tabela"),
                Var("email", "{row:email}"),
                A("If", a => { a.ConditionType = "Variable"; a.Key = "email"; a.ConditionOperator = "contains"; a.ConditionOperand = "@"; a.ConditionNegate = true; a.Comment = "Condition = NOT Met: e-mail sem @"; }),
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
            "Junta tudo: perguntas, rodízio, {clipboard:next} num While, escada de If, contador, Assert de limite e um subperfil (18b) que lê as variáveis deste. A 1ª linha copiada é o lote: ela muda a cada execução, e é isso que faz o {clipboard:next} recomeçar — copiar a mesma coisa não recomeça.",
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
                A("RunProfile", a => { a.Key = "18b · Assinatura"; a.RepeatCount = 1; a.Comment = "o subperfil lê {var:atendente}"; }))),

        new("18b · Assinatura", "✍️",
            "Subperfil chamado pelo 18. Roda dentro da mesma execução, então lê as variáveis de quem chamou. Rodado sozinho, sai sem o nome do atendente.",
            "completo", L(Abrir(),
                Txt("— {var:atendente}, {date}{enter}{enter}", "{var:atendente} vem do perfil 18"))),
    };

    // ── conferencia de tokens pelo resolvedor do proprio app ─────────────────────────────
    static Type? RunCtxT; static MethodInfo? ResolveM;
    static object Ctx(Dictionary<string, string>? vars = null, int iteration = 1, int loop = 0, int dataRow = 0, Dictionary<string, string>? row = null)
    {
        var ctx = Activator.CreateInstance(RunCtxT!)!;
        var f = BindingFlags.NonPublic | BindingFlags.Instance;
        if (vars != null) RunCtxT!.GetField("<Variables>k__BackingField", f)!.SetValue(ctx, new Dictionary<string, string>(vars, StringComparer.OrdinalIgnoreCase));
        if (row != null) RunCtxT!.GetField("<RowData>k__BackingField", f)!.SetValue(ctx, new Dictionary<string, string>(row, StringComparer.OrdinalIgnoreCase));
        RunCtxT!.GetField("<Iteration>k__BackingField", f)!.SetValue(ctx, iteration);
        RunCtxT!.GetField("<Loop>k__BackingField", f)!.SetValue(ctx, loop);
        RunCtxT!.GetField("<DataRow>k__BackingField", f)!.SetValue(ctx, dataRow);
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

        // 1) cada perfil: blocos bem formados + versao minima
        // Deterministico: data fixa e ids derivados do perfil + posicao, para regerar sem diff.
        var agora = new DateTime(2026, 9, 22, 12, 0, 0, DateTimeKind.Utc);
        var envelope = new TrueReplayer.Models.ProfileExportEnvelope { Version = 1, ExportedAt = agora.ToString("o") };
        foreach (var e in exs)
            for (int i = 0; i < e.Actions.Count; i++)
                e.Actions[i].Id = Convert.ToHexString(System.Security.Cryptography.MD5.HashData(
                    System.Text.Encoding.UTF8.GetBytes($"truereplayer-exemplo|{e.Name}|{i}"))).ToLowerInvariant();
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
            bool nomeOk = TrueReplayer.Services.ProfileNameValidator.IsSafe(e.Name);
            bool okBloco = v.OrphansRemoved == 0 && v.EndIfsAppended == 0 && copia.Count == e.Actions.Count;
            bool okDesc = e.Desc.Length <= 500;
            if (!okBloco || !nomeOk || !okDesc) problemas++;
            Console.WriteLine($"  {(okBloco && nomeOk && okDesc ? "OK  " : "FAIL")} {e.Name,-32} {e.Actions.Count,2} linhas  min {min ?? "-",-7} desc {e.Desc.Length,3}/500{(okBloco ? "" : $"  BLOCO orfaos={v.OrphansRemoved} endif+={v.EndIfsAppended}")}{(nomeOk ? "" : "  NOME INVALIDO")}");
            envelope.Profiles.Add(new TrueReplayer.Models.ProfileExportEntry
            {
                Name = e.Name, Actions = new ObservableCollection<TrueReplayer.Models.ActionItem>(e.Actions),
                EnableLoop = e.Loops > 1, LoopCount = e.Loops, Data = e.Data,
                Description = e.Desc, Tags = new List<string> { "exemplo", e.Tag }, IconEmoji = e.Emoji,
                CreatedAt = agora, UpdatedAt = agora, ProfileVersion = 1, AppMinVersion = min,
            });
        }
        envelope.Organization = new TrueReplayer.Models.ProfileExportOrganization
        {
            Folders = new() { new TrueReplayer.Models.ProfileFolder { Name = "Exemplos", Color = "#9B7BFF", Collapsed = false, Items = exs.Select(x => x.Name).ToList() } },
        };

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

        // 3) saidas citadas, conferidas no resolvedor de tokens
        var rep = typeof(TrueReplayer.Services.ActionReplayer);
        RunCtxT = rep.GetNestedType("RunCtx", BindingFlags.Public | BindingFlags.NonPublic)!;
        ResolveM = rep.GetMethod("ResolveTokensAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
        Console.WriteLine("\nTOKENS");
        var c = Ctx();
        await Check("04 como veio", "[{clipboard}]", "  maria SOUZA  ", c, "[  maria SOUZA  ]");
        await Check("04 trim:lower:title", "{clipboard:trim:lower:title}", "  maria SOUZA  ", c, "Maria Souza");
        await Check("04 sem lower (a ordem importa)", "{clipboard:trim:title}", "  maria SOUZA  ", c, "re:.*");
        await Check("04 digits", "{clipboard:digits}", "+55 (11) 98888-7777", c, "5511988887777");
        var cad = "Maria Souza\nmaria@email.com\nVendedor - 2x Caixa Rara";
        await Check("05 line:2", "{clipboard:line:2}", cad, c, "maria@email.com");
        await Check("05 word:1", "{clipboard:word:1}", cad, c, "Maria");
        await Check("05 after", "{clipboard:line:3:after: - }", cad, c, "2x Caixa Rara");
        await Check("05 after+dropnum", "{clipboard:line:3:after: - :dropnum:x }", cad, c, "Caixa Rara");
        var fr = "banana\nmaçã\nbanana\nabacaxi";
        await Check("06 sort:dedupe:join", "{clipboard:sort:dedupe:join:, }", fr, c, "abacaxi, banana, maçã");
        await Check("06 dedupe:count", "{clipboard:dedupe:count}", fr, c, "3");
        await Check("06 reverse:join", "{clipboard:reverse:join: / }", fr, c, "abacaxi / banana / maçã / banana");
        await Check("07 valor guardado", "{clipboard:trim:title}", "  joão pedro  ", c, "João Pedro");
        await Check("07 var:upper", "{var:cliente:upper}", null, Ctx(new() { ["cliente"] = "João Pedro" }), "JOÃO PEDRO");
        await Check("09 counter:pad:3 (volta 2)", "Item {counter:pad:3} — total: {var:total}", null, Ctx(new() { ["total"] = "20" }, iteration: 2), "Item 002 — total: 20");
        var ls = new Dictionary<string, string> { ["lista"] = "Ana\nBia\nCaio", ["i"] = "2" };
        await Check("11 volta 1", "Volta {counter}: {var:lista:line:@counter} — e a {var:i}ª é sempre {var:lista:line:@i}", null, Ctx(ls, iteration: 1), "Volta 1: Ana — e a 2ª é sempre Bia");
        await Check("11 volta 3", "{var:lista:line:@counter}", null, Ctx(ls, iteration: 3), "Caio");
        await Check("15 volta", "Volta {loop}: i = {var:i}", null, Ctx(new() { ["i"] = "4" }, loop: 4), "Volta 4: i = 4");
        await Check("17 linha de dados", "{datarow}. {row:nome} — Premium: enviar brinde para {row:email}", null,
            Ctx(dataRow: 1, row: new() { ["nome"] = "Ana", ["email"] = "ana@exemplo.com", ["plano"] = "Premium" }), "1. Ana — Premium: enviar brinde para ana@exemplo.com");
        await Check("18b assinatura", "— {var:atendente}", null, Ctx(new() { ["atendente"] = "Rita" }), "— Rita");
        await Check("02 +7 dias", "{date:+7:dd/MM/yyyy}", null, c, DateTime.Now.AddDays(7).ToString("dd/MM/yyyy"));
        await Check("02 ontem (dddd)", "{date:-1:dddd}", null, c, "re:.+");
        await Check("02 date e time", "{date} — {time}", null, c, "re:.+");
        await Check("03 pick", "{Pick:Olá|Oi|Bom dia}", null, c, "re:^(Olá|Oi|Bom dia)$");
        await Check("03 random", "{random:1-60}", null, c, "re:^([1-9]|[1-5][0-9]|60)$");
        await Check("14 caminho com env", "{env:WINDIR}\\notepad.exe", null, c, "re:(?i)^[a-z]:\\\\windows\\\\notepad\\.exe$");
        await Check("18 lote", "Lote {time}", null, c, "re:^Lote .+");
        // O Bloco de Notas copia com CRLF: as mesmas saidas com \r\n.
        var cadCr = cad.Replace("\n", "\r\n"); var frCr = fr.Replace("\n", "\r\n");
        await Check("05 line:2 (CRLF)", "{clipboard:line:2}", cadCr, c, "maria@email.com");
        await Check("05 word:1 (CRLF)", "{clipboard:word:1}", cadCr, c, "Maria");
        await Check("05 after+dropnum (CRLF)", "{clipboard:line:3:after: - :dropnum:x }", cadCr, c, "Caixa Rara");
        await Check("06 sort:dedupe:join (CRLF)", "{clipboard:sort:dedupe:join:, }", frCr, c, "abacaxi, banana, maçã");
        await Check("06 dedupe:count (CRLF)", "{clipboard:dedupe:count}", frCr, c, "3");
        await Check("06 reverse:join (CRLF)", "{clipboard:reverse:join: / }", frCr, c, "abacaxi / banana / maçã / banana");
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
        Console.WriteLine($"  arquivo do 14 existe nesta máquina: {File.Exists(Environment.ExpandEnvironmentVariables("%WINDIR%\\notepad.exe"))}");

        Console.WriteLine($"\nRESULTADO: perfis/pacote com problema: {problemas} · tokens {pass} ok / {fail} falha");
        return problemas == 0 && fail == 0 ? 0 : 1;
    }
}
