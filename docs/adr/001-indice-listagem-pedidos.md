# ADR 001: Índice composto para a listagem de pedidos por usuário

- **Status:** Aceito
- **Data:** 2026-11
- **Contexto do projeto:** mini-e-commerce, Fase 1

## Contexto

O endpoint `GET /users/:userId/orders` filtra pedidos por `userId`, ordena por `createdAt DESC, id DESC` e pagina com `LIMIT/OFFSET`.

O Postgres **não cria índice automaticamente para chaves estrangeiras**. A FK `order.userId` só gerou a constraint de integridade. Por isso, a query fazia `Seq Scan` na tabela inteira.

Medição com 50.000 pedidos e 500 usuários (distribuição desigual: um usuário com 6.341 pedidos, outro com 13), usando `EXPLAIN (ANALYZE, BUFFERS)`:

| Cenário                        | Plano                            | Buffers | Tempo   |
| ------------------------------ | -------------------------------- | ------- | ------- |
| Usuário pesado (6.341 pedidos) | Seq Scan + Sort (top-N heapsort) | 1032    | ~4,0 ms |
| Usuário leve (13 pedidos)      | Seq Scan + Sort (quicksort)      | 1032    | ~3,2 ms |

O custo era o mesmo para os dois usuários, porque o banco lia a tabela inteira e descartava quase tudo. Esse custo cresce linearmente com o tamanho da tabela.

## Decisão

Criar um índice composto B-tree em `order`, declarado na entity com `@Index(['userId', 'createdAt', 'id'])` e aplicado por migration.

- `userId` vem primeiro, porque é filtro por igualdade e leva direto ao trecho do usuário.
- `createdAt` e `id` vêm depois, para as entradas já estarem na ordem pedida, eliminando o `Sort`.
- O `id` no final serve de desempate, garantindo ordem determinística entre páginas.

## Resultado

| Cenário                    | Plano                         | Buffers | Tempo    |
| -------------------------- | ----------------------------- | ------- | -------- |
| Listagem, usuário pesado   | Index Scan Backward, sem Sort | 23      | ~0,05 ms |
| Listagem, usuário leve     | Index Scan Backward, sem Sort | 5       | ~0,04 ms |
| `count(*)`, usuário pesado | Index Only Scan               | 49      | ~1,1 ms  |
| `count(*)`, usuário leve   | Index Only Scan               | 4       | ~0,07 ms |

- O custo da listagem passou a depender do tamanho da página (20 linhas), e não do tamanho da tabela nem do histórico do usuário.
- Os tempos absolutos são pequenos porque a tabela é pequena e está em cache. O indicador mais confiável é `Buffers`, e o padrão de crescimento (linear no Seq Scan, quase constante no índice) é o que justifica a decisão.

## Consequências

**Positivas**

- Listagem rápida e previsível, independentemente do volume.
- O índice atende qualquer prefixo (`userId` sozinho, `userId + createdAt`), inclusive o `count` por usuário.
- A verificação da FK `ON DELETE RESTRICT` ao remover um usuário deixa de varrer a tabela.

**Negativas / trade-offs**

- Custo extra em todo `INSERT`, `UPDATE` de colunas indexadas e `DELETE` em `order`.
- Espaço adicional em disco e memória.
- Não ajuda queries que filtram só por `createdAt` (a primeira coluna do índice é `userId`).

**Limitações conhecidas (não resolvidas por esta decisão)**

- `count(*)` continua proporcional ao número de pedidos do usuário (49 buffers para 6.341 pedidos).
- `OFFSET` profundo continua caro, porque o banco percorre e descarta as linhas anteriores.

## Alternativas consideradas

- **Índice só em `userId`:** resolve o filtro, mas mantém o `Sort` em memória para cada usuário.
- **Sem índice:** aceitável só enquanto a tabela for pequena; o custo cresce com ela.
- **Paginação por cursor** (`WHERE createdAt < :último`): elimina o custo do `OFFSET` profundo. Adiada, pode ser reavaliada se houver usuários com históricos muito grandes.
- **Total aproximado ou em cache** no lugar do `count(*)` exato: adiada pelo mesmo motivo.

## Referências

- Migration: `AddOrderUserCreatedIndex`
- Query avaliada: `SELECT * FROM "order" WHERE "userId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT 20 OFFSET 0`
