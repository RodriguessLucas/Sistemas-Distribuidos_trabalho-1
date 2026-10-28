# Análise do Trabalho 1

Este documento registra o diagnóstico anterior à implementação. Para o estado
atual, a configuração Docker e as evidências de execução, consulte `README.md`.

## Objetivo e contexto

O trabalho pede completar um sistema de aprendizagem federada em Python com
gRPC, respeitando a estrutura entregue pelo professor e validando cada etapa com
testes. A simulação sequencial `codigo/fl_sim_manual.py` explica o algoritmo;
a implementação a entregar está em `codigo/start`.

Cada cliente recebe os pesos globais, treina regressão logística sobre sua partição
IID do Iris e envia parâmetros, número de exemplos e métricas. O servidor espera
uma contribuição por cliente, calcula FedAvg ponderado pelo número de exemplos,
avalia o modelo e abre a rodada seguinte. Os dados de treino não são enviados
nas mensagens gRPC.

O kit utiliza quatro atributos do Iris, divisão local de 80% para treino e 20% para
teste e um modelo com `warm_start=True`, `max_iter=1` e `solver="saga"`.
`common_fl.py` já fornece essa lógica. Para avaliação didática, o próprio servidor
carrega os testes de todas as partições; portanto, o kit não representa isolamento
total dos dados entre organizações. Não há requisito de alterar essa arquitetura.

## Estado inicial verificado

- Há 10 funções incompletas: quatro no cliente e seis no servidor.
- `should_wait`, inicialização do servidor, CLI e desligamento já estão fornecidos.
- O `while True` do cliente contém apenas comentários: a análise sintática acusa
  `expected an indented block` antes mesmo de importar dependências.
- O servidor tem sintaxe válida, mas suas seis funções pendentes lançam
  `NotImplementedError`.
- Existem 15 testes `unittest` em cinco arquivos, usando mocks para modelo,
  dados, avaliação e transporte em diferentes etapas.
- `federated.proto` existe; `federated_pb2.py` e `federated_pb2_grpc.py` ainda não.
- `codigo/pyproject.toml` declara Python >=3.9 e dependências de aprendizado,
  mas não declara `grpcio` nem `grpcio-tools`, exigidos pelo README.
- No Python 3 consultado, NumPy está disponível, mas `grpc`, `grpc_tools`,
  `sklearn` e `flwr_datasets` não. Isso não comprova ausência em outros ambientes.
- O PDF recomenda um ambiente Python 3.14; o projeto aceita >=3.9. A preparação
  deve verificar a compatibilidade das dependências com a versão escolhida.

## Sequência de execução proposta

| Etapa | Trabalho necessário | Evidência |
| --- | --- | --- |
| 1 | Preparar ambiente em `codigo`, incluir dependências gRPC e gerar arquivos protobuf em `codigo/start` | Imports e geração funcionando |
| 2 | Implementar `params_from_proto`, `params_to_proto` e `build_client_update`; tornar o corpo do laço sintaticamente válido durante a implementação | 3 testes de `test_01_client_serialization` |
| 3 | Implementar `_params_to_proto`, `_proto_to_params` e `GetGlobalModel` | 4 testes de `test_03_server_serialization_and_get` |
| 4 | Implementar `_validate_update` com os motivos de recusa esperados | 4 testes de `test_04_server_validation` |
| 5 | Implementar `SubmitUpdate` e `_consolidate_round_if_ready`, preservando o lock | 2 testes de `test_05_server_submit_and_consolidate` |
| 6 | Completar `run_client`: consulta, espera, treino, envio, aceite, tratamento de erro e término | 2 testes de `test_02_client_loop` |
| 7 | Executar a suíte completa e depois servidor e clientes reais | 15 testes aprovados e execução distribuída concluída |

O mapa segue a ordem didática do README, mesmo que a numeração dos arquivos de
teste coloque o laço do cliente antes dos testes do servidor.

## Pontos que exigem atenção

- Não avançar a rodada antes de receber todas as contribuições esperadas.
- Não contar duas vezes um mesmo cliente nem aceitar uma rodada divergente.
- Guardar `completed_round` só após confirmação positiva do servidor.
- Preservar os formatos NumPy e a ponderação do FedAvg. As médias das métricas
  locais impressas pelo guia são aritméticas; os parâmetros são ponderados.
- Não adquirir novamente o mesmo `threading.Lock` dentro dos auxiliares chamados
  sob o lock de `SubmitUpdate`.
- A resposta final ainda precisa conter modelo e rodada, mesmo com `done=True`.
- O servidor desliga ao sinalizar o término. Clientes podem receber `UNAVAILABLE`
  no envio ou na consulta seguinte; tratar essa condição sem esconder outros erros.
  Indisponibilidade isolada não demonstra que o treinamento terminou com sucesso.
- Os testes atuais não cobrem comunicação real, todas as recusas no laço do
  cliente, polling repetido, corridas de encerramento ou o valor numérico real do
  FedAvg, que é mockado no teste de consolidação.
- A execução real depende do download ou cache do dataset `hitorilabs/iris`.
- Não há requisito de interface web, banco de dados, Docker, criptografia,
  tolerância a clientes ausentes, acurácia mínima ou melhora a cada rodada.

## Validação e execução após implementar

Com o ambiente preparado e ativo, execute em `codigo/start`:

```bash
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. federated.proto
python -m unittest tests.test_01_client_serialization -v
python -m unittest tests.test_03_server_serialization_and_get -v
python -m unittest tests.test_04_server_validation -v
python -m unittest tests.test_05_server_submit_and_consolidate -v
python -m unittest tests.test_02_client_loop -v
python -m unittest discover -s tests -v
```

Para uma execução inicial pequena, inicie o servidor e depois cada cliente em
terminais separados, todos no mesmo ambiente e em `codigo/start`:

```bash
python student_fl_server_grpc.py --num-clients 2 --rounds 2
```

```bash
python student_fl_client_grpc.py --cid 0 --num-clients 2
```

```bash
python student_fl_client_grpc.py --cid 1 --num-clients 2
```

Observe duas consolidações, métricas e encerramento. Depois confira a configuração
padrão de cinco clientes e cinco rodadas, usando IDs de 0 a 4.

## Entregas desta análise

Foram criadas duas skills locais em `skills/`, referenciadas pelo `AGENTS.md` da
raiz para orientar futuras implementações neste projeto. A preferência do usuário
por código sem comentários foi registrada sem exigir limpeza dos arquivos
didáticos intocados ou dos arquivos gerados.

Nenhuma função do sistema foi implementada nesta etapa. Não foram instaladas
dependências nem executados os testes funcionais; o diagnóstico foi feito por
leitura do PDF, guia, contrato, fontes e testes, inspeção de dependências e análise
sintática. Os critérios são uma definição de aceite, não uma declaração de que o
sistema já os satisfaz.
