# Trabalho 1 — Aprendizagem Federada com gRPC

Sistema da disciplina de Sistemas Distribuídos: servidor e cinco clientes Python
treinam regressão logística sobre partições do Iris durante cinco rodadas.
O servidor agrega os parâmetros por FedAvg, ponderando pelo número de exemplos.

## Histórico e regras

A branch `main` preserva o material e a análise inicial. O desenvolvimento ocorre
em `develop/trabalho1`; a infraestrutura e implementação ficam nessa branch até
revisão. Nenhuma regra original do código ou material pode ser alterada. Consulte
`AGENTS.md` e as duas skills em `skills/`. Código novo não contém comentários
explicativos; instruções didáticas intactas e arquivos gerados são preservados.

## Origem do código, dados e referências

- Base do trabalho: `codigo.zip` entregue pelo professor no SIGAA, já extraído
  em `codigo/`. O contrato e as funções de aprendizado fornecidas são preservados.
- Contexto e requisitos: `trabalho-1.pdf` e `codigo/start/README.md`.
- Referência conceitual apresentada em aula:
  [What is Federated Learning?](https://flower.ai/docs/framework/tutorial-series-what-is-federated-learning.html).
- Exemplo oficial relacionado:
  [Quickstart scikit-learn](https://flower.ai/docs/framework/tutorial-quickstart-scikitlearn.html).
- Dados: [hitorilabs/iris](https://huggingface.co/datasets/hitorilabs/iris), baixados
  pelo `flwr-datasets` e particionados pelo `IidPartitioner` do código original.
- Bibliotecas Python: PyPI. Imagem base: imagem oficial `python:3.12-slim` do
  Docker Hub. Python 3.12 atende ao `requires-python >=3.9` do projeto; o PDF
  recomenda 3.14, mas não o exige. As dependências principais do Docker estão
  fixadas em `requirements-docker.txt`; as transitivas são resolvidas pelo pip.

O framework Flower completo não substitui o cliente e servidor pedidos. Aqui,
o gRPC e a coordenação das rodadas são implementados diretamente para a atividade;
a biblioteca Flower Datasets é reutilizada para os dados. Não é necessário clonar
outro projeto para executar o trabalho.

## Docker

Requisitos: Docker Engine e Docker Compose v2, com permissão de acesso ao daemon.
Na raiz do repositório:

```bash
docker build -t trabalho1:local .
docker compose --profile test run --rm tests
docker compose up --no-build
```

O build instala dependências e gera `federated_pb2.py` e
`federated_pb2_grpc.py` a partir do `.proto`. O serviço `dataset` prepara o cache
antes do servidor. Os cinco clientes aguardam o servidor ficar acessível via
gRPC. Cada cliente usa seu próprio ID e o endereço interno `server:50051`.
O processo termina automaticamente após as cinco rodadas, com métricas no terminal.
Não use `--abort-on-container-exit`: o serviço de preparação encerra antes dos
demais, e o servidor pode encerrar antes de os clientes consultarem o estado final.

O comando `docker compose build` também pode construir a imagem quando o plugin
Buildx está instalado. No ambiente inicial, ele falhou por ausência do Buildx;
`docker build` utilizou o builder legado como alternativa.

Para acompanhar e conferir os códigos de saída:

```bash
docker compose logs server client-0 client-1 client-2 client-3 client-4
docker compose ps -a
```

Para executar a simulação sequencial original:

```bash
docker compose --profile simulation run --rm simulation
```

Para remover os contêineres e a rede, preservando o cache do dataset:

```bash
docker compose down
```

O primeiro download exige internet. O volume `huggingface-cache` evita baixar os
dados novamente. A porta do servidor é publicada apenas em `127.0.0.1:50051`.
Não há bind mount do código: após editar fontes ou testes, reconstrua a imagem.

## Validação

Os 15 testes originais foram preservados. Cinco testes adicionais verificam a
espera por nova rodada, reprocessamento após recusa e tratamento dos erros gRPC.
A suíte utiliza mocks; verifique também os logs da execução real para confirmar
as cinco consolidações e o encerramento dos seis processos.

O servidor carrega os conjuntos de teste para avaliação, conforme o kit. Isso é
uma simplificação didática e não representa isolamento completo dos dados.
Uma mensagem de servidor indisponível não comprova conclusão: confira as rodadas
e a mensagem final do servidor. Não há meta obrigatória de acurácia.
