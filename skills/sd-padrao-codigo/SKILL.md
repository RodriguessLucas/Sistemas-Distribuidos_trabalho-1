---
name: sd-padrao-codigo
description: Aplicar o padrão Python e a preferência de código sem comentários ao implementar ou revisar o cliente e servidor gRPC do Trabalho 1 deste repositório.
---

# Padrão de código

- Complete os pontos faltantes em `codigo/start/student_fl_client_grpc.py` e
  `codigo/start/student_fl_server_grpc.py`, preservando nomes, assinaturas, CLI,
  campos protobuf e arquitetura fornecidos.
- Reutilize `common_fl.py` para carregar dados, criar modelos, treinar, agregar e
  avaliar. Não reimplemente essa camada nem substitua o dataset ou o modelo para
  facilitar os testes. `codigo/fl_sim_manual.py` é referência didática.
- Use indentação de quatro espaços, funções e variáveis em `snake_case`, classes
  em `PascalCase` e constantes em `UPPER_SNAKE_CASE`, acompanhando o kit.
- Prefira funções curtas, nomes claros, retornos antecipados e tipos compatíveis
  com a versão Python declarada. Evite dependências, abstrações e reformatações
  sem necessidade para o trabalho.
- Código escrito ou alterado deve ficar sem comentários explicativos, comentários
  inline, TODOs resolvidos ou docstrings explicativas. Ao completar uma função,
  remova suas dicas e docstring didática, usando nomes e estrutura legíveis.
  Registre explicações em Markdown separado.
- Não faça uma limpeza global dos comentários do material original, dos testes ou
  de funções intocadas. Preserve cabeçalhos e comentários de arquivos gerados pelo
  compilador protobuf; regenere-os a partir do `.proto`, sem editá-los à mão.
- Preserve os testes fornecidos e os auxiliares prontos. Não use mocks no código
  de produção nem adapte mensagens ou resultados com valores artificiais.
- Mantenha logs úteis em português para rodada, cliente, métricas, recusa e fim.
  Mensagens verificadas pelos testes devem conservar as palavras exigidas.
- Proteja o estado compartilhado e preserve a ordem de consolidação definida no
  guia. Não durma nem faça chamadas de rede dentro do lock do servidor.
- Capture erros específicos, sem `except` genérico que silencie falhas. Não trate
  indisponibilidade como prova de conclusão de todas as rodadas.
- Se ajustar dependências, inclua o runtime gRPC e a ferramenta de geração no
  ambiente reproduzível, mantendo as dependências de aprendizado já fornecidas.

Na revisão, aplique também `../sd-criterios-aceitacao/SKILL.md` e informe o que foi
verificado, o resultado e qualquer limitação real do ambiente.
