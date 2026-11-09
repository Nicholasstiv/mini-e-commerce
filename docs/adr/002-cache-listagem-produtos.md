# ADR 002: Cache da listagem de produtos com Redis

- **Status:** Aceito
- **Data:** 2026-11
- **Contexto do projeto:** mini-e-commerce, Fase 1

## Contexto

`GET /products` devolve o catálogo inteiro. É uma leitura frequente de um dado que muda pouco, e cada chamada repete a mesma query no Postgres e a hidratação das entities do TypeORM.

Medição com ~5.200 produtos (MISS = chave ausente no Redis, HIT = chave presente):

| Cenário | Tempo |
|---|---|
| MISS (estável) | ~90 a 100 ms |
| HIT | ~14 a 20 ms |

Uma primeira medição de ~180 ms foi descartada como ruído de cache frio (pool de conexões e caches do Postgres e do Node ainda não aquecidos).

## Decisão

Usar **Redis com o padrão cache-aside**, com `ioredis` direto (sem a abstração do `@nestjs/cache-manager`, para manter visíveis os comandos reais).

- **Leitura:** `GET products:list`. Em HIT, devolve. Em MISS, busca no Postgres, grava com `SET ... EX 60` e devolve.
- **Escrita (`create`, `update`, `remove` de produto):** grava no Postgres e **depois** executa `DEL products:list`. A ordem importa: invalidar antes de gravar permitiria que uma leitura intermediária repovoasse o cache com o dado antigo.
- **TTL de 60 s** como rede de segurança: qualquer dado velho se corrige sozinho em até um minuto.
- **O `stock` fica na resposta cacheada.** Pedidos (`create` e `cancel`) **não** invalidam o cache.
- **Falhas do Redis nunca derrubam a API.** Toda operação de cache é envolvida em `try/catch`: leitura que falha vira MISS, escrita e invalidação que falham geram só um `warn`. O client usa `enableOfflineQueue: false` e `maxRetriesPerRequest: 1` para falhar rápido em vez de pendurar requisições.

### Por que pedidos não invalidam o cache

Um pedido altera o `stock`. Invalidar a cada pedido faria a chave morrer constantemente em um sistema movimentado, anulando o cache. A decisão é segura porque **a venda nunca confia no cache**: o `create` decrementa o estoque com `UPDATE ... WHERE stock >= qty` e lê o preço dentro da transaction, direto do Postgres. Um `stock` desatualizado na listagem afeta só o que o cliente vê. O pior caso é ver "5 em estoque" quando restam 3 e receber `409` ao comprar, comportamento que já é tratado.

## Consequências

**Positivas**
- HIT cerca de 5 a 6 vezes mais rápido que MISS nesta amostra.
- Menos carga no Postgres sob leitura concorrente: muitas requisições viram leituras de Redis.
- Se o Redis cair, a API continua respondendo (mais lenta, mas correta) e o cache volta sozinho quando ele retorna.

**Negativas / trade-offs**
- **Dado possivelmente desatualizado por até 60 s**, principalmente o `stock`. Aceito, pelo motivo acima.
- **Janela de corrida na invalidação:** entre o `save` no banco e o `DEL`, uma leitura pode repopular o cache com o dado antigo. Limitada pelo TTL.
- **Datas viram string no HIT.** O cache guarda JSON, então `createdAt` e `updatedAt` voltam como strings ISO, não `Date`. A resposta HTTP é idêntica, mas código que receba o cache e dependa de `Date` quebraria. O `as Product[]` é uma simplificação do TypeScript.
- **Piso de ~15 ms no HIT:** leitura do Redis, `JSON.parse` de milhares de objetos e serialização da resposta têm custo próprio. O cache não elimina isso.

**Limitações conhecidas (não resolvidas por esta decisão)**
- **A listagem não é paginada.** Só funciona para catálogos pequenos; o payload e o JSON cacheado crescem com o catálogo. É a limitação mais importante.
- **Cache stampede:** com a chave vazia, várias requisições simultâneas podem dar MISS ao mesmo tempo e todas consultar o Postgres.
- Uma única chave serve enquanto não houver paginação ou filtros. Depois, cada combinação vira uma chave (`products:list:page=2`) e invalidar "todas" exige `SCAN` ou chaves versionadas.

## Alternativas consideradas

- **Invalidar também a cada pedido:** dado sempre fresco, mas o cache quase nunca sobreviveria o bastante para dar HIT.
- **Remover o `stock` da listagem cacheada** (expor só "disponível / indisponível"): elimina a desatualização visível, ao custo de menos informação para o cliente.
- **Atualizar o `stock` dentro do cache a cada pedido:** dado mais fresco, porém complexo e fácil de errar (cache e banco podem divergir).
- **`@nestjs/cache-manager`:** menos código, mas esconde os comandos do Redis. Pode ser adotado depois.
- **Mitigar stampede** com lock curto ou *single flight*: adiado, desnecessário na escala atual.
- **Paginar a listagem:** a evolução natural; adiada para quando o catálogo justificar.

## Referências

- Chave: `products:list`, TTL 60 s
- Implementação: `ProductsService` (`findAll`, `invalidateList`) e `RedisModule`
