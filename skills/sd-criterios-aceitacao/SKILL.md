---
name: sd-criterios-aceitacao
description: Implementar ou revisar os critérios de aceitação do Trabalho 1 de Sistemas Distribuídos deste repositório, com aprendizagem federada sobre Iris via gRPC.
---

# Critérios de aceitação

Regra universal: preserve todas as regras originais do código e material
fornecido em qualquer alteração do projeto. Estes critérios complementam as
fontes; não autorizam substituir nem flexibilizar seus requisitos.

Resolva caminhos a partir da raiz que contém `trabalho-1.pdf`. Leia o enunciado,
`codigo/start/README.md`, `codigo/start/federated.proto` e os testes correspondentes
antes de modificar o comportamento. A tarefa é completar o kit existente.

## Contrato obrigatório

- Cliente e servidor convertem `[coef, intercept]` para `ModelParameters` e de volta.
  Preserve valores, matriz de coeficientes, formato e vetor de interceptos;
  reconstrua arrays com `np.float64`.
- `build_client_update` preenche `cid`, `round`, `num_examples`, `train_loss`,
  `train_acc` e `model` a partir do resultado real do treino.
- `GetGlobalModel` retorna rodada atual, total de rodadas, mensagem, modelo e
  `done = current_round > total_rounds`. Preserve o modelo e a rodada também no fim.
- `_validate_update` rejeita, nesta ordem, treinamento encerrado, rodada diferente
  da atual e cliente duplicado na rodada. Mensagens incluem, respectivamente,
  `terminou`, `rodada` e `duplicada`. Uma atualização válida retorna `(True, "OK")`.
- `SubmitUpdate` valida antes de alterar o estado. Uma recusa devolve
  `UpdateAck(accepted=False, message=..., server_round=current_round)` sem
  armazenar nem consolidar. Uma aceitação armazena os parâmetros desserializados,
  número de exemplos e métricas por `cid`, tenta consolidar e responde com a
  rodada atual do servidor após a operação.
- Consolide somente quando `len(received_updates) == num_clients`. Use
  `aggregate_fedavg`, que pondera os parâmetros pelo número de exemplos.
  Avalie com `evaluate_global_model`, imprima métricas globais e médias locais,
  limpe o buffer e incremente a rodada nessa ordem. Ao superar `total_rounds`,
  sinalize `training_finished`.
- Preserve a exclusão mútua de leitura e alteração do estado com `self.lock`.
  Os auxiliares chamados dentro de `SubmitUpdate` não devem adquirir novamente
  esse `threading.Lock`, que não é reentrante.
- O cliente consulta `GetGlobalModel`, encerra quando `done`, espera quando
  `should_wait` e só treina uma rodada nova. Envia a atualização e registra
  `completed_round` apenas após `ack.accepted`. Exibe métricas ou motivo da recusa
  e respeita `poll_interval`.
- Atenda à orientação do TODO do cliente de tratar `grpc.RpcError` no envio e
  `StatusCode.UNAVAILABLE` com mensagem e encerramento. Considere também a
  consulta após o desligamento do servidor; não oculte outros erros como sucesso.
- Preserve o encerramento do servidor via `training_finished` e `server.stop`.

## Evidências de conclusão

Prepare as dependências e gere o protobuf real antes dos testes. No diretório
`codigo/start`, use:

```bash
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. federated.proto
python -m unittest discover -s tests -v
```

Execute os testes de cada etapa e depois os 15 testes fornecidos em conjunto.
Eles usam mocks para treino e transporte; a aprovação não comprova comunicação
real. Faça também uma execução com servidor e clientes em processos separados,
IDs distintos de `0` a `num_clients - 1` e a mesma quantidade configurada de
clientes. Verifique avanço apenas após todas as respostas, métricas e término.
Não exija uma acurácia mínima nem melhora monotônica: o material não as define.

Se ambiente, rede ou download do dataset impedir uma verificação, registre o
impedimento e não declare essa evidência como aprovada. Validações adicionais de
IDs, dimensões ou valores são melhorias opcionais, não exigências do enunciado.
