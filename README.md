# Conferência: app x Calculadora RTC oficial

Robô que compila e roda a calculadora oficial da Receita Federal
([calculadora-rtc-regime-regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular)),
gera dezenas de milhares de casos e compara cada resultado com o motor do app (`harness/engine.js`).
Os resultados ficam na pasta `resultados/` (resumo, divergências e mensagens de erro diferentes).

## Último resultado (25/11/2026)

| | |
|---|---|
| Calculadora oficial | versão 1.7.2, commit `f1eebd7`, base V0073 (09/11/2026) |
| Casos comparados | 200.252 (39 datas, inclui as bordas de vigência da base) |
| Cálculos iguais | 147.997 |
| Recusas com a mesma mensagem | 52.255 |
| Divergências | **0** |

O comparador detecta diferenças de 1 centavo (prova feita alterando saídas reais da calculadora oficial).
