"""Exporta a base oficial (calculadora-rtc-regime-regular) para os JSON do app.
Números saem como TEXTO do próprio SQLite (CAST AS TEXT), que é o que o sqlite-jdbc entrega
ao BigDecimal da calculadora oficial. Datas saem exatamente como gravadas (comparação textual)."""
import sqlite3, json, sys, re, html
con = sqlite3.connect(sys.argv[1]); out = sys.argv[2]
q = lambda s: [list(r) for r in con.execute(s)]
T = lambda c: f"CAST({c} AS TEXT)"   # número como o sqlite-jdbc devolve
R = {}
R["versao"] = q("select VRBD_VERSAO_BASE_DADO, substr(VRBD_DATA,1,10), VRBD_DESCRICAO from VERSAO_BASE_DADO order by VRBD_ID desc limit 1")[0]
R["tributo"] = q("select TBTO_ID, TBTO_INICIO_VIGENCIA, TBTO_FIM_VIGENCIA from TRIBUTO")
R["sit"] = q("select SITR_ID, SITR_CD, SITR_DESCRICAO, SITR_INICIO_VIGENCIA, SITR_FIM_VIGENCIA, SITR_IND_GIBSCBS, SITR_IND_GRED from SITUACAO_TRIBUTARIA")
R["trst"] = q("select TRST_SITR_ID, TRST_TBTO_ID, TRST_INICIO_VIGENCIA, TRST_FIM_VIGENCIA from TRIBUTO_SITUACAO_TRIBUTARIA order by TRST_ID")
R["cl"] = q("""select CLTR_ID, CLTR_CD, CLTR_DESCRICAO, CLTR_TIPO_ALIQUOTA, CLTR_SITR_ID, CLTR_NOMENCLATURA,
  CLTR_INICIO_VIGENCIA, CLTR_FIM_VIGENCIA, CLTR_IND_GMONOPADRAO, CLTR_IND_GMONORETEN, CLTR_IND_GMONORET, CLTR_IND_GMONODIF
  from CLASSIFICACAO_TRIBUTARIA order by CLTR_ID""")
R["tc"] = q("select TRCL_CLTR_ID, TRCL_TRTR_ID, TRCL_INICIO_VIGENCIA, TRCL_FIM_VIGENCIA from TRATAMENTO_CLASSIFICACAO order by TRCL_ID")
R["tt"] = q("""select TRTR_ID, TRTR_DESCRICAO, TRTR_EXPRESSAO_ALIQUOTA, TRTR_EXPRESSAO_ALIQUOTA_EFETIVA, TRTR_EXPRESSAO_BASE_CALCULO,
  TRTR_EXPRESSAO_TRIBUTO_CALCULADO, TRTR_EXPRESSAO_TRIBUTO_DEVIDO, TRTR_EXPRESSAO_PERCENTUAL_DIFERIMENTO, TRTR_EXPRESSAO_VALOR_DIFERIMENTO,
  TRTR_IN_EXIGE_GRUPO_DESONERACAO, TRTR_IN_INCOMPATIVEL_COM_SUSPENSAO, TRTR_IN_POSSUI_PERCENTUAL_REDUCAO, TRTR_IN_POSSUI_AJUSTE,
  TRTR_IN_POSSUI_MONOFASIA from TRATAMENTO_TRIBUTARIO""")
R["ref"] = q(f"select ALRE_ID, ALRE_TBTO_ID, {T('ALRE_VALOR')}, ALRE_INICIO_VIGENCIA, ALRE_FIM_VIGENCIA from ALIQUOTA_REFERENCIA order by ALRE_ID")
R["padrao"] = q("select * from ALIQUOTA_PADRAO")
R["red"] = q(f"select PERE_CLTR_ID, PERE_TBTO_ID, {T('PERE_VALOR')}, PERE_INICIO_VIGENCIA, PERE_FIM_VIGENCIA from PERCENTUAL_REDUCAO order by PERE_ID")
R["aadv"] = q(f"select AADV_ID, {T('AADV_VALOR')}, AADV_TBTO_ID, AADV_INICIO_VIGENCIA, AADV_FIM_VIGENCIA, AADV_CLTR_ID from ALIQUOTA_AD_VALOREM order by AADV_ID")
R["aavs"] = q("select AAVS_ID, AAVS_NBS_CD, AAVS_AADV_ID, AAVS_INICIO_VIGENCIA, AAVS_FIM_VIGENCIA from ALIQUOTA_AD_VALOREM_SERVICO order by AAVS_ID")
R["eavs"] = q("select EAVS_NBS_CD, EAVS_AAVS_ID, EAVS_INICIO_VIGENCIA, EAVS_FIM_VIGENCIA from EXCECAO_AD_VALOREM_SERVICO")
R["aavp"] = q("select AAVP_ID, AAVP_NCM_CD, AAVP_AADV_ID, AAVP_INICIO_VIGENCIA, AAVP_FIM_VIGENCIA from ALIQUOTA_AD_VALOREM_PRODUTO order by AAVP_ID")
R["eavp"] = q("select EAVP_NCM_CD, EAVP_AAVP_ID, EAVP_INICIO_VIGENCIA, EAVP_FIM_VIGENCIA from EXCECAO_AD_VALOREM_PRODUTO")
R["aare"] = q(f"select a.AARE_ID, {T('a.AARE_VALOR')}, u.UNMD_SIGLA, a.AARE_TBTO_ID, a.AARE_INICIO_VIGENCIA, a.AARE_FIM_VIGENCIA from ALIQUOTA_AD_REM a join UNIDADE_MEDIDA u on u.UNMD_ID=a.AARE_UNMD_ID order by a.AARE_ID")
R["aarp"] = q("select AARP_ID, AARP_NCM_CD, AARP_AARE_ID, AARP_INICIO_VIGENCIA, AARP_FIM_VIGENCIA from ALIQUOTA_AD_REM_PRODUTO order by AARP_ID")
R["earp"] = q("select EARP_NCM_CD, EARP_AARP_ID, EARP_INICIO_VIGENCIA, EARP_FIM_VIGENCIA from EXCECAO_AD_REM_PRODUTO")
R["unid"] = q("select UNMD_SIGLA, UNMD_DESCRICAO from UNIDADE_MEDIDA order by UNMD_ID")
R["ncma"] = q("select NCMA_ID, NCMA_NCM_CD, NCMA_CLTR_ID, NCMA_INICIO_VIGENCIA, NCMA_FIM_VIGENCIA from NCM_APLICAVEL order by NCMA_ID")
R["encm"] = q("select ENCM_NCM_CD, ENCM_NCMA_ID, ENCM_INICIO_VIGENCIA, ENCM_FIM_VIGENCIA from EXCECAO_NCM_APLICAVEL")
R["nbsa"] = q("select NBSA_ID, NBSA_NBS_CD, NBSA_CLTR_ID, NBSA_INICIO_VIGENCIA, NBSA_FIM_VIGENCIA from NBS_APLICAVEL order by NBSA_ID")
R["enbs"] = q("select ENBS_NBS_CD, ENBS_NBSA_ID, ENBS_INICIO_VIGENCIA, ENBS_FIM_VIGENCIA from EXCECAO_NBS_APLICAVEL")
# códigos NCM/NBS de qualquer nível, com vigência (existeNcm/existeNbs comparam o código exato)
R["ncmcod"] = q("select NCM_CD, NCM_INICIO_VIGENCIA, NCM_FIM_VIGENCIA from NCM order by NCM_CD")
R["nbscod"] = q("select NBS_CD, NBS_INICIO_VIGENCIA, NBS_FIM_VIGENCIA from NBS order by NBS_CD")
json.dump(R, open(f"{out}/regras.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
def clean(s):
    s = re.sub(r"<sup>(\d+)</sup>", lambda m: m.group(1).translate(SUP), s or "")
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    return re.sub(r"\s+", " ", re.sub(r"^[\s\-–]+", "", s)).strip()
pos = {c: clean(d) for c, d in con.execute("select NCM_CD, NCM_DESCRICAO from NCM where length(NCM_CD)=4")}
niv = {c: clean(d) for c, d in con.execute("select NCM_CD, NCM_DESCRICAO from NCM where length(NCM_CD) in (5,6,7)")}
ncm = [[c, clean(d), i, f] for c, d, i, f in con.execute("select NCM_CD, NCM_DESCRICAO, NCM_INICIO_VIGENCIA, NCM_FIM_VIGENCIA from NCM where length(NCM_CD)=8 order by 1")]
nbs = [[c, clean(d), i, f] for c, d, i, f in con.execute("select NBS_CD, NBS_DESCRICAO, NBS_INICIO_VIGENCIA, NBS_FIM_VIGENCIA from NBS where length(NBS_CD)=9 order by 1")]
json.dump({"pos": pos, "niv": niv, "ncm": ncm, "nbs": nbs}, open(f"{out}/nomenclaturas.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("versão", R["versao"][0], "| classificações", len(R["cl"]), "| ncm(8)", len(ncm), "| nbs(9)", len(nbs))
