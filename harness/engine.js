/* Motor CBS / IBS / Imposto Seletivo — porte fiel da Calculadora RTC oficial
 * (ReceitaFederal/calculadora-rtc-regime-regular, versão 1.7.2, base V0073), para UM item
 * do regime geral, sem tpDoc, sem compra governamental e sem componentes de base de cálculo.
 * Ordem das validações, arredondamentos (HALF_EVEN, um arredondamento por número publicado)
 * e mensagens de erro seguem: ProcessamentoItemService, CalculoTributoService,
 * CalculoCbsIbsService, CalculoImpostoSeletivoService, AvaliadorExpressaoAritmetica,
 * ArredondamentoUtils, NcmAplicavelService/NbsAplicavelService e os repositórios.
 */
(function (root) {
  "use strict";
  const Dec = (typeof module !== "undefined" && module.exports) ? require("decimal.js") : root.Decimal;
  const D = Dec.clone({ precision: 300, rounding: Dec.ROUND_HALF_EVEN });           // + − × exatos
  const DDIV = Dec.clone({ precision: 34, rounding: Dec.ROUND_HALF_EVEN });         // CONTEXTO_DIVISAO
  const d = (v) => new D(String(v));
  const ZERO = d(0);
  const HE = D.ROUND_HALF_EVEN;
  const valorFiscal = (x) => x == null ? null : x.toDecimalPlaces(2, HE);            // arredondarValorFiscal
  const aliqPublicada = (x) => x == null ? null : x.toDecimalPlaces(4, HE);          // arredondarAliquotaPublicada
  const pctFracao = (x) => x == null ? null : x.div(100);                            // percentualParaFracao (exata)
  const fracaoPct = (x) => x == null ? null : x.times(100);                          // fracaoParaPercentual (exata)
  const publicarAliquota = (f) => pctFracao(aliqPublicada(fracaoPct(f)));
  const dividir = (a, b) => d(new DDIV(a.toString()).div(new DDIV(b.toString())).toString());
  const vig = (ini, fim, data) => ini <= data && (fim == null || data <= fim);      // :data BETWEEN ini AND COALESCE(fim,:data)
  const branco = (s) => s == null || String(s).trim() === "";
  const TRIB = { IS: 1, CBS: 2, IBS_ESTADUAL: 3, IBS_MUNICIPAL: 4 };
  const NOME_TRIB = { 1: "Imposto Seletivo", 2: "CBS e IBS" };

  class ErroCalculo extends Error { constructor(msg, tipo) { super(msg); this.tipo = tipo || "oficial"; } }
  const erro = (msg) => { throw new ErroCalculo(msg, "oficial"); };

  /* ---------- índices ---------- */
  function indexar(R, N) {
    const I = { R, N };
    I.tributo = new Map(R.tributo.map((t) => [t[0], { ini: t[1], fim: t[2] }]));
    I.sit = new Map(R.sit.map((s) => [s[0], { id: s[0], cd: s[1], desc: s[2], ini: s[3], fim: s[4], gIbsCbs: !!s[5], gRed: !!s[6] }]));
    I.cl = R.cl.map((c) => ({ id: c[0], cd: c[1], desc: c[2], tipo: c[3], sitr: c[4], nomenclatura: c[5], ini: c[6], fim: c[7],
      mono: !!(c[8] || c[9] || c[10] || c[11]) }));
    I.clById = new Map(I.cl.map((c) => [c.id, c]));
    I.tt = new Map(R.tt.map((t) => [t[0], { id: t[0], desc: t[1], aliq: t[2], efet: t[3], bc: t[4], tc: t[5], td: t[6], pdif: t[7], vdif: t[8],
      exigeDesoneracao: !!t[9], incompSuspensao: !!t[10], reducao: !!t[11], ajuste: !!t[12], monofasia: !!t[13] }]));
    I.aadv = new Map(R.aadv.map((a) => [a[0], { id: a[0], valor: a[1], tbto: a[2], ini: a[3], fim: a[4], cltr: a[5] }]));
    I.aare = new Map(R.aare.map((a) => [a[0], { id: a[0], valor: a[1], unid: a[2], tbto: a[3], ini: a[4], fim: a[5] }]));
    I.ncmcod = new Map(); for (const n of R.ncmcod) { if (!I.ncmcod.has(n[0])) I.ncmcod.set(n[0], []); I.ncmcod.get(n[0]).push(n); }
    I.nbscod = new Map(); for (const n of R.nbscod) { if (!I.nbscod.has(n[0])) I.nbscod.set(n[0], []); I.nbscod.get(n[0]).push(n); }
    if (N) { I.ncm = new Map(N.ncm.map((n) => [n[0], n])); I.nbs = new Map(N.nbs.map((n) => [n[0], n])); }
    return I;
  }
  const existeCodigo = (mapa, cod, data) => (mapa.get(cod) || []).some((n) => vig(n[1], n[2], data));
  const existeQualquer = (mapa, cod) => mapa.has(cod);                                // EXISTS ... WHERE n.codigo = :ncm (sem data)

  /* ---------- avaliador (JEXL estrito, BigDecimal exato, divisão em 34 dígitos) ---------- */
  function avaliar(expr, vars) {
    const e = String(expr).trim();
    if (Object.prototype.hasOwnProperty.call(vars, e)) return vars[e];
    const t = []; const re = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/()])/y; re.lastIndex = 0;
    while (re.lastIndex < e.length) { const m = re.exec(e); if (!m) throw new ErroCalculo("Erro ao avaliar expressão: " + e, "interno"); t.push(m[1]); }
    let i = 0;
    const prim = () => {
      const k = t[i++];
      if (k === "(") { const v = soma(); if (t[i++] !== ")") throw new ErroCalculo("Erro ao avaliar expressão: " + e, "interno"); return v; }
      if (k === "-") return prim().neg();
      if (k === "+") return prim();
      if (/^\d/.test(k)) return d(k);
      if (!Object.prototype.hasOwnProperty.call(vars, k)) throw new ErroCalculo("Variável indefinida na expressão: " + k, "interno");
      return vars[k];
    };
    const prod = () => { let v = prim(); while (t[i] === "*" || t[i] === "/") { const op = t[i++], r = prim();
      if (op === "*") v = v.times(r); else { if (r.isZero()) throw new ErroCalculo("Division by zero", "interno"); v = dividir(v, r); } } return v; };
    const soma = () => { let v = prod(); while (t[i] === "+" || t[i] === "-") { const op = t[i++], r = prod(); v = op === "+" ? v.plus(r) : v.minus(r); } return v; };
    const v = soma(); if (i !== t.length) throw new ErroCalculo("Erro ao avaliar expressão: " + e, "interno"); return v;
  }
  // entry(): valor nulo vira ZERO no mapa de variáveis
  const mapa = (o) => { const m = {}; for (const k of Object.keys(o)) m[k] = o[k] == null ? ZERO : o[k]; return m; };

  /* ---------- repositórios ---------- */
  function existeCst(I, cst, tributo, data) {
    return I.R.trst.some((t) => t[1] === tributo && I.sit.get(t[0]).cd === cst && vig(t[2], t[3], data)
      && vig(I.sit.get(t[0]).ini, I.sit.get(t[0]).fim, data));
  }
  function validarCst(I, cst, tributo, data) {
    if (!existeCst(I, cst, tributo, data)) erro(`Situação tributária (CST) não encontrada para código ${cst} e data ${data} (${NOME_TRIB[tributo]})`);
  }
  function situacaoPorCodigo(I, cst, tributo, data) {
    const tb = I.tributo.get(tributo);
    for (const t of I.R.trst) {
      const s = I.sit.get(t[0]);
      if (s.cd === cst && t[1] === tributo && vig(t[2] || "", t[3], data) && vig(s.ini || "", s.fim, data) && tb && vig(tb.ini || "", tb.fim, data)) return s;
    }
    return null;
  }
  function classificacao(I, cd, tributo, data) {
    const tb = I.tributo.get(tributo);
    for (const c of I.cl) {
      if (c.cd !== cd || !vig(c.ini, c.fim, data)) continue;
      const s = I.sit.get(c.sitr); if (!vig(s.ini, s.fim, data)) continue;
      if (!I.R.trst.some((t) => t[0] === s.id && t[1] === tributo && vig(t[2], t[3], data))) continue;
      if (!tb || !vig(tb.ini, tb.fim, data)) continue;
      return { id: c.id, codigo: c.cd, nomenclatura: c.nomenclatura, cst: s.cd, cl: c };
    }
    erro(`Classificação tributária não encontrada para código ${cd} e data ${data} (${NOME_TRIB[tributo]})`);
  }
  function tratamentoClassificacao(I, clId, data) {
    const r = I.R.tc.find((x) => x[0] === clId && vig(x[2], x[3], data));
    if (!r) erro(`Tratamento tributário não encontrado para classificação tributária com id ${clId} e data ${data}`);
    return { idTratamento: r[1], idClassificacao: clId, incompSuspensao: I.tt.get(r[1]).incompSuspensao, exigeDesoneracao: I.tt.get(r[1]).exigeDesoneracao };
  }
  function percentualReducao(I, clId, tributo, data) {
    const r = I.R.red.filter((x) => x[0] === clId && x[1] === tributo && vig(x[3], x[4], data));
    if (r.length > 1) erro("Consulta retornou múltiplos valores quando apenas um era esperado.");
    if (!r.length || r[0][2] == null) erro(`Percentual de redução não encontrado para classificação tributária com id ${clId} e data ${data}`);
    return d(r[0][2]);
  }
  function aliquotaReferencia(I, tributo, data) {
    const r = I.R.ref.filter((x) => x[1] === tributo && vig(x[3], x[4], data));
    if (!r.length || r[0][2] == null) erro(`Alíquota de referência não encontrada para o tributo com id ${tributo} e data ${data}`);
    return d(r[0][2]);
  }
  function aliquotaPadrao(I, tributo, data) {
    // FROM AliquotaReferencia r LEFT JOIN AliquotaPadrao p (vazia na base): vale r.valor
    const r = I.R.ref.filter((x) => x[1] === tributo && vig(x[3], x[4], data));
    if (!r.length) throw new ErroCalculo("Erro interno da calculadora oficial ao buscar a alíquota padrão (sem alíquota de referência na data).", "interno");
    if (I.R.padrao.length) throw new ErroCalculo("A base tem alíquotas próprias de estados ou municípios, que este app ainda não calcula.", "nao-suportado");
    if (r[0][2] == null) erro("Alíquota de referência não encontrada");   // AliquotaResultadoDTO
    return d(r[0][2]);
  }
  function adValoremPorClassificacao(I, tributo, clId, data) {
    const r = [...I.aadv.values()].filter((a) => a.tbto === tributo && a.cltr === clId && vig(a.ini, a.fim, data));
    if (r.length > 1) erro("Consulta retornou múltiplos valores quando apenas um era esperado.");
    return r.length && r[0].valor != null ? d(r[0].valor) : null;
  }
  function excluido(excecoes, idRegra, codigo, codigoRegra, data) {
    return excecoes.some((e) => e[1] === idRegra && vig(e[2], e[3], data) && (codigo.startsWith(e[0]) || codigoRegra.startsWith(e[0])));
  }
  // AliquotaAdValoremServicoRepository.buscarAliquotaAdValoremDto (sem LIMIT: mais de uma linha = erro)
  function adValoremServicoDto(I, nbs, tributo, clId, data) {
    if (!nbs || !existeQualquer(I.nbscod, nbs)) return null;
    const r = I.R.aavs.filter((a) => { const ad = I.aadv.get(a[2]);
      return nbs.startsWith(a[1]) && ad.tbto === tributo && (clId == null || ad.cltr === clId) && vig(a[3], a[4], data) && !excluido(I.R.eavs, a[0], nbs, a[1], data); });
    if (r.length > 1) erro("Consulta retornou múltiplos valores quando apenas um era esperado.");
    return r.length ? { valor: I.aadv.get(r[0][2]).valor } : null;
  }
  const existeNbsAdValorem = (I, nbs, tributo, data) => !!nbs && existeQualquer(I.nbscod, nbs) && I.R.aavs.some((a) => {
    const ad = I.aadv.get(a[2]); return nbs.startsWith(a[1]) && ad.tbto === tributo && vig(a[3], a[4], data) && !excluido(I.R.eavs, a[0], nbs, a[1], data); });
  function produtoMaisEspecifico(I, ncm, tributo, data, lista, excecoes, base) {
    if (!existeQualquer(I.ncmcod, ncm)) return null;
    const r = lista.filter((a) => ncm.startsWith(a[1]) && base(a[2]).tbto === tributo && vig(a[3], a[4], data) && !excluido(excecoes, a[0], ncm, a[1], data));
    if (!r.length) return null;
    let melhor = r[0]; for (const a of r) if (a[1].length > melhor[1].length) melhor = a;   // ORDER BY LENGTH DESC LIMIT 1
    return melhor;
  }
  function adValoremProduto(I, ncm, tributo, data) {
    const a = produtoMaisEspecifico(I, ncm, tributo, data, I.R.aavp, I.R.eavp, (id) => I.aadv.get(id));
    return a ? { valor: I.aadv.get(a[2]).valor } : null;
  }
  const existeNcmAdValorem = (I, ncm, tributo, data) => !!produtoMaisEspecifico(I, ncm, tributo, data, I.R.aavp, I.R.eavp, (id) => I.aadv.get(id));
  function adRemProduto(I, ncm, tributo, data) {
    const a = produtoMaisEspecifico(I, ncm, tributo, data, I.R.aarp, I.R.earp, (id) => I.aare.get(id));
    return a ? { valor: I.aare.get(a[2]).valor, unidade: I.aare.get(a[2]).unid } : null;
  }

  /* ---------- anexos de NCM/NBS (tabela-verdade do NcmAplicavelService) ---------- */
  function validarAplicavel(I, tipo, codigo, clId, clCd, data) {
    const apl = tipo === "NCM" ? I.R.ncma : I.R.nbsa, exc = tipo === "NCM" ? I.R.encm : I.R.enbs;
    const completo = (codigo || "").length === (tipo === "NCM" ? 8 : 9);
    const tem = apl.some((n) => n[2] === clId && vig(n[3], n[4], data));
    if (tem && !completo) erro(tipo === "NCM" ? "NCM completo não informado" : "NBS completo não informado");
    if (!completo || !tem) return;
    const A = apl.some((n) => codigo.startsWith(n[1]) && n[2] === clId && vig(n[3], n[4], data));
    if (!A) erro(`${tipo} de código ${codigo} não vinculada à Classificação Tributária de código ${clCd} (CBS e IBS)`);
    const E = exc.some((e) => { const n = apl.find((x) => x[0] === e[1]); return n && codigo.startsWith(n[1]) && codigo.startsWith(e[0]) && n[2] === clId && vig(e[2], e[3], data); });
    const S = apl.some((n) => codigo.startsWith(n[1]) && n[2] === clId && vig(n[3], n[4], data)
      && (() => { const es = exc.filter((e) => e[1] === n[0]); return !es.length || es.some((e) => !vig(e[2], e[3], data)); })());
    if (E && !S) erro(`${tipo} de código ${codigo} não vinculada à Classificação Tributária de código ${clCd} (CBS e IBS)`);
  }

  /* ---------- CalculoCbsIbsService ---------- */
  function calcularCbsIbs(I, tributo, item, tcl, isCalculado, temTribReg, data) {
    const tt = I.tt.get(tcl.idTratamento), cl = I.clById.get(tcl.idClassificacao), sitCl = I.sit.get(cl.sitr);
    const situacao = situacaoPorCodigo(I, item.cst, tributo, data);
    if (tt.ajuste) erro(`A classificação tributária ${cl.cd} ainda não possui tratamento tributário implementado na Calculadora. Essa funcionalidade está prevista no roadmap e será disponibilizada em versão futura.`);
    if (tt.monofasia) throw new ErroCalculo("Combustíveis com tributação monofásica não são calculados neste app. Use a calculadora oficial.", "nao-suportado");
    const quantidade = d(item.quantidade), baseInformada = item.baseCalculo == null ? null : d(item.baseCalculo);
    const isInformado = item.impostoSeletivo ? d(item.impostoSeletivo.impostoInformado ?? 0) : null;
    let red = null;
    if (tt.reducao) red = pctFracao(percentualReducao(I, cl.id, tributo, data));
    const tipo = cl.cd === "510001" ? "Padrão" : cl.tipo;
    const nominal = item.aliquotasNominais ? ({ 2: item.aliquotasNominais.cbs, 3: item.aliquotasNominais.ibsEstadual, 4: item.aliquotasNominais.ibsMunicipal })[tributo] : null;
    const informada = nominal == null ? null : d(nominal);
    let valorAliquota = null, aplicada = false, dividida = false;
    switch (tipo) {
      case "Padrão":
        if (informada != null) { valorAliquota = pctFracao(informada); aplicada = true; } else valorAliquota = pctFracao(aliquotaPadrao(I, tributo, data));
        dividida = true; break;
      case "Uniforme nacional (referência)":
        if (informada != null) { valorAliquota = pctFracao(informada); aplicada = true; } else valorAliquota = pctFracao(aliquotaReferencia(I, tributo, data));
        dividida = true; break;
      case "Uniforme setorial": {
        if (informada != null) { valorAliquota = pctFracao(informada); aplicada = true; }
        else {
          let a = adValoremServicoDto(I, item.nbs, tributo, cl.id, data); a = a ? (a.valor == null ? null : d(a.valor)) : null;
          if (a == null) a = adValoremPorClassificacao(I, tributo, cl.id, data);
          if (a == null) erro(`Alíquota uniforme setorial não encontrada em ${data}`);
          valorAliquota = pctFracao(a);
        }
        dividida = true; break;
      }
      case "Fixa": {
        if (informada != null) { valorAliquota = pctFracao(informada); aplicada = true; }
        else { const a = adValoremPorClassificacao(I, tributo, cl.id, data); if (a == null) erro(`Alíquota fixa não encontrada em ${data}`); valorAliquota = pctFracao(a); }
        dividida = true; break;
      }
      case "Sem alíquota":
        if (informada != null) { valorAliquota = pctFracao(informada); aplicada = true; dividida = true; } else valorAliquota = ZERO;
        break;
      case "Alíquotas Combinadas (Ad Valorem e Ad Rem)": break;
      default: erro(`Tipo de alíquota desconhecido: ${tipo}`);
    }
    const comum = { aliquotaPadraoOuReferencia: null, aliquotaReferencia: null, aliquotaAdValorem: null, aliquotaAdRem: null, ajuste: null, redutor: null,
      aliquotaAdRemPrincipal: null, aliquotaAdRemSecundaria: null, variacaoPontoPercentual: null, pBio: null };
    let rAliq = null;
    const usaAliquota = !branco(tt.aliq) && /(^|[^A-Za-z0-9_])aliquota([^A-Za-z0-9_]|$)/.test(tt.aliq);
    if (aplicada && !usaAliquota) rAliq = valorAliquota;
    else if (!branco(tt.aliq)) rAliq = avaliar(tt.aliq, mapa(Object.assign({ aliquota: valorAliquota, quantidade, percentualReducao: red, percentualDiferimento: null }, comum)));
    if (dividida) rAliq = publicarAliquota(rAliq);
    let rEfet = null;
    if (!branco(tt.efet)) {
      rEfet = avaliar(tt.efet, mapa(Object.assign({ quantidade, aliquota: rAliq, percentualReducao: red, pRedutorCompraGov: ZERO, percentualDiferimento: null }, comum)));
      if (dividida) rEfet = publicarAliquota(rEfet);
    }
    const v2 = Object.assign({ quantidade, aliquota: rAliq, aliquotaEfetiva: rEfet, impostoSeletivoInformado: isInformado, baseCalculoInformada: baseInformada,
      impostoSeletivoCalculado: isCalculado, percentualReducao: red, percentualDiferimento: null }, comum);
    let base = valorFiscal(avaliar(tt.bc, mapa(v2)));
    if (base.isNegative()) base = ZERO;
    const v3 = Object.assign({}, v2, { baseCalculo: base });
    const calcExato = avaliar(tt.tc, mapa(v3));
    const calc = valorFiscal(calcExato);
    let devido = null;
    if (!branco(tt.td)) devido = valorFiscal(avaliar(tt.td, mapa(Object.assign({}, v3, { tributoCalculado: calc }))));
    let pDif = null, vDif = null;
    if (!branco(tt.pdif) && !branco(tt.vdif)) {
      pDif = publicarAliquota(avaliar(tt.pdif, mapa(Object.assign({}, v3, { tributoCalculado: calc }))));
      vDif = valorFiscal(avaliar(tt.vdif, mapa(Object.assign({}, v3, { percentualDiferimento: pDif, tributoCalculado: calcExato }))));
      devido = calc.minus(vDif); if (devido.isNegative()) devido = ZERO;
    }
    const memoria = { tipo, aplicada, dividida, valorAliquota, rAliq, rEfet, red, base, calc, devido, pDif, vDif, tt, isCalculado, isInformado, baseInformada };
    if (!situacao) throw new ErroCalculo("Erro interno da calculadora oficial: situação tributária não encontrada para o tributo.", "interno");
    if (!situacao.gIbsCbs) return { semGrupo: true, memoria };
    let gRed = null;
    if (sitCl.gRed && !(temTribReg)) {
      if (red != null && rEfet != null) gRed = { pRedAliq: fracaoPct(red), pAliqEfet: dividida ? fracaoPct(rEfet) : rEfet };
    }
    let tribReg = null;
    if (temTribReg) {
      // obterGrupoDesoneracao: percentualReducao chega como requireNonNullElse(red, ZERO)
      let ef = rAliq; const r0 = red == null ? ZERO : red;
      if (tt.reducao && r0 != null) ef = rAliq == null ? null : rAliq.times(d(1).minus(r0));
      if (dividida) ef = publicarAliquota(ef);
      tribReg = { cst: item.tributacaoRegular.cst, cClassTrib: item.tributacaoRegular.cClassTrib, base,
        aliquotaEfetiva: dividida ? fracaoPct(ef) : ef, tributoDevido: ef == null ? null : valorFiscal(base.times(ef)) };
    }
    return {
      aliquota: temTribReg ? ZERO : (dividida && rAliq != null ? fracaoPct(rAliq) : rAliq),
      tributoCalculado: temTribReg ? ZERO : calc, tributoDevido: temTribReg ? ZERO : devido, baseCalculo: base,
      gRed, gDif: (vDif != null && pDif != null) ? { pDif: fracaoPct(pDif), vDif } : null, tribReg, memoria,
    };
  }

  /* ---------- CalculoImpostoSeletivoService ---------- */
  function calcularIS(I, item, tcl, aIS) {
    const tt = I.tt.get(tcl.idTratamento), is = item.impostoSeletivo;
    let adv = aliqPublicada(aIS.adValorem); if (adv != null) adv = pctFracao(adv);
    const adr = aliqPublicada(aIS.adRem);
    const v = { quantidade: is.quantidade == null ? null : d(is.quantidade), baseCalculoInformada: d(is.baseCalculo), impostoSeletivoInformado: d(is.impostoInformado ?? 0),
      impostoSeletivoCalculado: ZERO, aliquotaAdValorem: adv, aliquotaAdRem: adr, aliquota: null, aliquotaEfetiva: null, percentualReducao: null,
      aliquotaPadraoOuReferencia: null, aliquotaReferencia: null, ajuste: null, redutor: null };
    const base = valorFiscal(avaliar(tt.bc, mapa(v)));
    const v3 = Object.assign({}, v, { baseCalculo: base });
    const calc = valorFiscal(avaliar(tt.tc, mapa(v3)));
    const devido = branco(tt.td) ? null : valorFiscal(avaliar(tt.td, mapa(Object.assign({}, v3, { tributoCalculado: calc }))));
    return { CSTIS: is.cst, cClassTribIS: is.cClassTrib, vBCIS: base, pIS: fracaoPct(adv), pISEspec: adr, uTrib: is.unidade, qTrib: is.quantidade, vIS: devido,
      memoria: { tt, adv, adr, base, calc, quantidade: v.quantidade } };
  }

  /* ---------- ProcessamentoItemService + CalculoTributoService ---------- */
  function calcular(I, entrada) {
    const data = entrada.data;
    if (!data) erro("A data do fato gerador não foi informada.");
    const item = JSON.parse(JSON.stringify(entrada.item));
    if (item.quantidade == null) item.quantidade = "1";
    if (item.unidade == null) item.unidade = "UN";
    const ncm = item.ncm || null, nbs = item.nbs || null, vazio = (s) => s == null || String(s).trim() === "";
    // validarBaseCalculoLegado
    const isIn = item.impostoSeletivo;
    if (!isIn) { if (item.baseCalculo == null) erro("A base de cálculo de CBS e IBS deve ser informada quando o grupo do Imposto Seletivo não é informado"); }
    else {
      if (isIn.baseCalculo == null) erro("A base de cálculo do Imposto Seletivo deve ser informada quando o grupo de Imposto Seletivo é informado");
      const bcIS = d(isIn.baseCalculo);
      if (item.baseCalculo == null) item.baseCalculo = bcIS.plus(d(isIn.impostoInformado ?? 0)).toString();
      else if (isIn.impostoInformado != null) { if (!d(item.baseCalculo).eq(bcIS.plus(d(isIn.impostoInformado)))) erro(`A base de cálculo de CBS e IBS informada ${item.baseCalculo} difere da soma da base de cálculo do Imposto Seletivo ${isIn.baseCalculo} com o Imposto Seletivo informado ${isIn.impostoInformado}`); }
      else if (d(item.baseCalculo).lt(bcIS)) erro(`A base de cálculo de CBS e IBS informada ${item.baseCalculo} é menor que a base de cálculo do Imposto Seletivo ${isIn.baseCalculo}`);
    }
    // validarNcmNbs
    if (!vazio(ncm) && !vazio(nbs)) erro("Não é permitido informar NCM e NBS simultaneamente para um item");
    if (!vazio(ncm) && !existeCodigo(I.ncmcod, ncm, data)) erro(`NCM de código ${ncm} não encontrada para a data ${data}`);
    if (!vazio(nbs) && !existeCodigo(I.nbscod, nbs, data)) erro(`NBS de código ${nbs} não encontrada para a data ${data}`);
    validarCst(I, item.cst, TRIB.CBS, data);
    // validarAliquotasNominais
    const an = item.aliquotasNominais;
    if (Number(data.slice(0, 4)) < 2027) {
      const informou = an && (an.cbs != null || an.ibsEstadual != null || an.ibsMunicipal != null || (an.impostoSeletivo && (an.impostoSeletivo.adValorem != null || an.impostoSeletivo.adRem != null)));
      if (informou) erro("As alíquotas nominais não podem ser informadas para operações com fato gerador anterior a 01/01/2027, pois a calculadora resolve as alíquotas vigentes");
    } else {
      const s = situacaoPorCodigo(I, item.cst, TRIB.CBS, data);
      if (s && s.gIbsCbs && (!an || an.cbs == null || an.ibsEstadual == null || an.ibsMunicipal == null))
        erro("As alíquotas nominais (os três campos cbs, ibsEstadual e ibsMunicipal) devem ser informadas para operações com fato gerador a partir de 01/01/2027");
    }
    // obterTratamentoClassificacao
    let clCbs = classificacao(I, item.cClassTrib, TRIB.CBS, data);
    const conferirCst = (c, cst) => { if (vazio(ncm) && vazio(nbs)) return; if (c.cst !== cst) erro(`Classificação tributária (cClassTrib) de código ${c.codigo} não está vinculada à situação tributária (CST) de código ${cst} (CBS e IBS)`); };
    conferirCst(clCbs, item.cst);
    let tclCbs = tratamentoClassificacao(I, clCbs.id, data), tclDeson = null, temDeson = false;
    if (tclCbs.exigeDesoneracao) {
      if (!item.tributacaoRegular) erro(`Dados da tributação regular devem ser informados para cClassTrib ${item.cClassTrib} e CST ${item.cst}`);
      const cst = item.tributacaoRegular.cst, cct = item.tributacaoRegular.cClassTrib;
      tclDeson = tclCbs;
      clCbs = classificacao(I, cct, TRIB.CBS, data); conferirCst(clCbs, cst);
      tclCbs = tratamentoClassificacao(I, clCbs.id, data);
      if (tclCbs.incompSuspensao) erro(`Classificação tributária (cClassTrib) ${cct} e situação tributária (CST) ${cst} incompatíveis com suspensão`);
      temDeson = true;
    }
    if (vazio(ncm) && vazio(nbs)) { validarAplicavel(I, "NCM", ncm, clCbs.id, clCbs.codigo, data); validarAplicavel(I, "NBS", nbs, clCbs.id, clCbs.codigo, data); }
    if (!vazio(ncm) && vazio(nbs)) validarAplicavel(I, "NCM", ncm, clCbs.id, clCbs.codigo, data);
    if (!vazio(nbs) && vazio(ncm)) validarAplicavel(I, "NBS", nbs, clCbs.id, clCbs.codigo, data);
    let clIS = null;
    if (isIn) {
      validarCst(I, isIn.cst, TRIB.IS, data);
      clIS = classificacao(I, isIn.cClassTrib, TRIB.IS, data);
      if (clIS.cst !== isIn.cst) erro(`Classificação tributária (cClassTrib) de código ${clIS.codigo} não está vinculada à situação tributária (CST) de código ${isIn.cst} (Imposto Seletivo)`);
    }
    // analisarAliquotaImpostoSeletivo
    const anIS = isIn && an ? an.impostoSeletivo || null : null;
    if (anIS && anIS.adRem != null && vazio(isIn.unidade)) erro("A unidade de medida do Imposto Seletivo deve ser informada quando a alíquota ad rem é informada pelo usuário");
    let adv = anIS && anIS.adValorem != null ? d(anIS.adValorem) : null, adr = anIS && anIS.adRem != null ? d(anIS.adRem) : null;
    let unid = adr != null ? isIn.unidade : null;
    if (!vazio(ncm) && ncm.length === 8) {
      if (adv == null) { const b = adValoremProduto(I, ncm, TRIB.IS, data); if (b) adv = b.valor == null ? null : d(b.valor); }
      if (adr == null) { const b = adRemProduto(I, ncm, TRIB.IS, data); if (b) { adr = b.valor == null ? null : d(b.valor); unid = b.unidade; } }
    } else if (!vazio(nbs) && nbs.length === 9) {
      if (adv == null) { const b = adValoremServicoDto(I, nbs, TRIB.IS, null, data); adv = b && b.valor != null ? d(b.valor) : null; }
    }
    const aIS = (adv != null || adr != null) ? { adValorem: adv, adRem: adr, unidade: unid } : null;
    const tipoNom = !vazio(ncm) ? "NCM" : "NBS", codNom = !vazio(ncm) ? ncm : nbs;
    if (!aIS && Number(data.slice(0, 4)) >= 2027) {
      let incide = false;
      if (!vazio(ncm) && ncm.length === 8) incide = existeNcmAdValorem(I, ncm, TRIB.IS, data) || !!adRemProduto(I, ncm, TRIB.IS, data);
      else if (!vazio(nbs) && nbs.length === 9) incide = existeNbsAdValorem(I, nbs, TRIB.IS, data);
      if (incide) {
        if (!isIn) erro(`Dados do Imposto Seletivo devem ser informados para ${tipoNom} ${codNom} e data ${data}`);
        erro(`A alíquota do Imposto Seletivo deve ser informada em aliquotasNominais.impostoSeletivo para ${tipoNom} ${codNom} e data ${data}, pois ainda não foi definida em lei`);
      }
    }
    let tclIS = null;
    if (aIS) {
      if (!isIn) erro(`Dados do Imposto Seletivo devem ser informados para ${tipoNom} ${codNom} e data ${data}`);
      if (aIS.adRem != null) {
        if (isIn.quantidade == null) erro("A quantidade do Imposto Seletivo deve ser informada para alíquota ad rem");
        if (!d(isIn.quantidade).gt(0)) erro("A quantidade do Imposto Seletivo deve ser maior do que zero para alíquota ad rem");
        if (isIn.unidade == null) erro("A unidade de medida do Imposto Seletivo deve ser informada para alíquota ad rem");
      }
      if (item.quantidade != null && !d(item.quantidade).gt(0)) erro("A quantidade do item deve ser maior do que zero");
      tclIS = tratamentoClassificacao(I, clIS.id, data);
    }
    // CalculoTributoService.calcular
    let IS = null;
    if (tclIS) IS = calcularIS(I, item, tclIS, aIS);
    const isCalc = IS ? IS.vIS : ZERO;
    const res = {};
    for (const [k, t] of [["CBS", TRIB.CBS], ["IBSUF", TRIB.IBS_ESTADUAL], ["IBSMun", TRIB.IBS_MUNICIPAL]]) res[k] = calcularCbsIbs(I, t, item, tclCbs, isCalc, temDeson, data);
    const comGrupo = (x) => x && !x.semGrupo ? x : null;
    const cbs = comGrupo(res.CBS), uf = comGrupo(res.IBSUF), mun = comGrupo(res.IBSMun);
    let gIBSCBS = null;
    if (cbs || uf || mun) {
      const vBC = (cbs || uf || mun).baseCalculo;
      const gIBSUF = uf ? { pIBSUF: uf.aliquota, vIBSUF: uf.tributoDevido, gDif: uf.gDif, gRed: uf.gRed } : null;
      const gIBSMun = mun ? { pIBSMun: mun.aliquota, vIBSMun: mun.tributoDevido, gDif: mun.gDif, gRed: mun.gRed } : null;
      const vIBS = (gIBSUF && gIBSUF.vIBSUF ? gIBSUF.vIBSUF : ZERO).plus(gIBSMun && gIBSMun.vIBSMun ? gIBSMun.vIBSMun : ZERO);
      // getTributacaoRegular: encadeado CBS -> IBSUF -> IBSMun; um elo sem grupo devolve null (como no Java)
      let gTribRegular = null;
      for (const [k, x] of [["CBS", cbs], ["IBSUF", uf], ["IBSMun", mun]]) {
        if (x && x.tribReg) { if (!gTribRegular) gTribRegular = { CSTReg: x.tribReg.cst, cClassTribReg: x.tribReg.cClassTrib };
          gTribRegular["pAliqEfetReg" + k] = x.tribReg.aliquotaEfetiva; gTribRegular["vTribReg" + k] = x.tribReg.tributoDevido; }
        else gTribRegular = null;
      }
      gIBSCBS = { vBC, gIBSUF, gIBSMun, vIBS, gCBS: cbs ? { pCBS: cbs.aliquota, vCBS: cbs.tributoDevido, gDif: cbs.gDif, gRed: cbs.gRed } : null, gTribRegular };
    }
    // AvisoDadosSimuladosService
    let aviso = null;
    if (data > "2026-12-31") aviso = "CASO_CALCULOS_SIMULADOS";
    else if (["010", "220", "221"].includes(item.cst) && data > "2025-12-31") aviso = "CASO_ALIQUOTAS_FICTICIAS";
    return { IS, IBSCBS: { CST: item.cst, cClassTrib: item.cClassTrib, gIBSCBS }, aviso, calculoSimulado: item.aliquotasNominais != null,
      memoria: { CBS: res.CBS.memoria, IBSUF: res.IBSUF.memoria, IBSMun: res.IBSMun.memoria, tratamento: I.tt.get(tclCbs.idTratamento), tratamentoOriginal: tclDeson ? I.tt.get(tclDeson.idTratamento) : null } };
  }

  /* ---------- apoio à interface ---------- */
  function classificacoesVigentes(I, data) {
    const out = [];
    for (const c of I.cl) {
      if (!vig(c.ini, c.fim, data)) continue;
      const s = I.sit.get(c.sitr); if (!vig(s.ini, s.fim, data)) continue;
      if (!I.R.trst.some((t) => t[0] === s.id && t[1] === TRIB.CBS && vig(t[2], t[3], data))) continue;
      const r = I.R.tc.find((x) => x[0] === c.id && vig(x[2], x[3], data)); if (!r) continue;
      const tt = I.tt.get(r[1]);
      out.push({ id: c.id, cd: c.cd, desc: c.desc, tipo: c.tipo, cst: s.cd, sitDesc: s.desc, tratamento: tt.desc, tt, gIbsCbs: s.gIbsCbs });
    }
    return out;
  }
  function incidenciaIS(I, ncm, nbs, data) {
    if (ncm && ncm.length === 8) {
      const av = adValoremProduto(I, ncm, TRIB.IS, data), ar = adRemProduto(I, ncm, TRIB.IS, data);
      if (av || ar || existeNcmAdValorem(I, ncm, TRIB.IS, data)) return { adValorem: av ? av.valor : null, adRem: ar ? ar.valor : null, unidade: ar ? ar.unidade : null, temAdRem: !!ar };
    } else if (nbs && nbs.length === 9 && existeNbsAdValorem(I, nbs, TRIB.IS, data)) return { adValorem: null, adRem: null, unidade: null, temAdRem: false };
    return null;
  }
  function aplicavelSilencioso(I, tipo, codigo, clId, clCd, data) {
    try { validarAplicavel(I, tipo, codigo, clId, clCd, data); return true; } catch (e) { return false; }
  }
  const temAnexo = (I, tipo, clId, data) => (tipo === "NCM" ? I.R.ncma : I.R.nbsa).some((n) => n[2] === clId && vig(n[3], n[4], data));

  const API = { indexar, calcular, classificacoesVigentes, incidenciaIS, aplicavelSilencioso, temAnexo, ErroCalculo, Decimal: D, TRIB };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.MotorRTC = API;
})(typeof window !== "undefined" ? window : globalThis);
