# AWS Local Console

## 1. Visão geral

O **AWS Local Console** é um webapp para interagir visualmente com serviços AWS através de uma interface inspirada na AWS Management Console.

O sistema utilizará o **Floci como ambiente de execução dos serviços AWS**.

A plataforma deverá fornecer uma experiência semelhante à AWS Console para:

- visualizar serviços;
- criar recursos;
- consultar recursos;
- editar recursos;
- excluir recursos;
- executar operações AWS;
- visualizar requests e responses;
- consultar logs;
- visualizar eventos;
- explorar relacionamentos entre recursos;
- executar comandos;
- visualizar o estado do ambiente;
- criar cenários completos de infraestrutura.

O foco do projeto é permitir que o desenvolvedor possa executar e explorar serviços AWS através de uma interface web, tendo o **Floci como infraestrutura AWS local**.

---

# 2. Objetivos

## 2.1 Objetivo principal

Criar uma console web completa para interação com os serviços AWS disponibilizados pelo Floci.

Arquitetura:

```text
┌─────────────────────────────────────┐
│              Browser                │
│                                     │
│             Next.js                 │
│       TypeScript + React            │
│                                     │
│ Dashboard                           │
│ Services                            │
│ Resources                           │
│ API Explorer                        │
│ Architecture Explorer              │
│ Events                              │
│ Logs                                │
│ CLI                                 │
└──────────────────┬──────────────────┘
                   │
                   │ HTTP
                   ▼
┌─────────────────────────────────────┐
│              Go API                 │
│                                     │
│ Service Registry                    │
│ AWS Client Factory                  │
│ Operation Executor                  │
│ Resource Explorer                   │
│ Coverage                            │
│ Audit                               │
└──────────────────┬──────────────────┘
                   │
                   │ AWS SDK v2
                   ▼
┌─────────────────────────────────────┐
│               Floci                 │
│                                     │
│ S3                                  │
│ SQS                                 │
│ SNS                                 │
│ DynamoDB                            │
│ Lambda                              │
│ API Gateway                         │
│ EventBridge                         │
│ EC2                                 │
│ ECS                                 │
│ RDS                                 │
│ ...                                 │
└─────────────────────────────────────┘
```

---

# 3. Princípio fundamental

O **Floci é o ambiente de execução da plataforma**.

Não deverá existir uma camada de mocks simulando serviços AWS.

O fluxo real deverá ser:

```text
Usuário
   ↓
Next.js
   ↓
Go API
   ↓
AWS SDK
   ↓
Floci
   ↓
AWS Service
```

Por exemplo:

```text
Create S3 Bucket

Browser
   ↓
POST /operations/execute
   ↓
Go
   ↓
AWS SDK S3
   ↓
Floci
   ↓
S3 Bucket
```

O resultado retornado pelo Floci deverá ser apresentado ao usuário.

---

# 4. Stack

## Frontend

```text
Next.js
TypeScript
React
Tailwind CSS
TanStack Query
Zustand
React Hook Form
Zod
Monaco Editor
React Flow
xterm.js
```

## Backend

```text
Go
AWS SDK for Go v2
```

## Runtime

```text
Floci
Docker
Docker Compose
```

## Testes

```text
Playwright
```

**Não serão utilizados testes unitários como estratégia de validação do projeto.**

---

# 5. Filosofia de testes

O projeto será validado principalmente através de **testes End-to-End utilizando Playwright**.

O teste deverá reproduzir a utilização real da aplicação:

```text
Playwright
    ↓
Browser
    ↓
Next.js
    ↓
Go API
    ↓
AWS SDK
    ↓
Floci
    ↓
AWS Service
```

O objetivo é testar o sistema completo, e não componentes isolados.

---

# 6. Testes Playwright

O Playwright deverá validar:

- navegação;
- criação de recursos;
- alteração de recursos;
- exclusão de recursos;
- execução de operações;
- requests;
- responses;
- mensagens de erro;
- estados da interface;
- filtros;
- busca;
- dashboard;
- integração entre serviços;
- arquitetura;
- eventos;
- logs.

---

# 7. Teste completo de exemplo

Criar bucket S3:

```text
1. Abrir aplicação
2. Abrir Services
3. Abrir S3
4. Abrir Create Bucket
5. Informar nome
6. Clicar em Create
7. Verificar sucesso
8. Verificar bucket na lista
```

O Playwright deverá executar esse fluxo através da UI.

```typescript
test("should create an S3 bucket", async ({ page }) => {
  await page.goto("/services/s3");

  await page.getByRole("button", {
    name: "Create bucket",
  }).click();

  await page.getByLabel("Bucket name")
    .fill("playwright-test-bucket");

  await page.getByRole("button", {
    name: "Create",
  }).click();

  await expect(
    page.getByText("playwright-test-bucket")
  ).toBeVisible();
});
```

O teste não deverá mockar o S3.

O bucket deverá realmente existir no Floci.

---

# 8. Testes de integração através da UI

Os testes deverão validar fluxos completos.

Exemplo:

```text
S3
 │
 │ ObjectCreated
 ▼
EventBridge
 │
 ▼
SQS
 │
 ▼
Lambda
 │
 ▼
DynamoDB
```

Playwright deverá:

```text
1. Criar bucket
2. Configurar evento
3. Criar queue
4. Criar Lambda
5. Configurar integração
6. Upload de objeto
7. Aguardar processamento
8. Verificar mensagem
9. Verificar execução Lambda
10. Verificar item DynamoDB
```

Isso será considerado um **E2E Scenario**.

---

# 9. Estrutura dos testes

```text
tests/
└── e2e/
    ├── dashboard/
    │   └── dashboard.spec.ts
    │
    ├── services/
    │   ├── s3.spec.ts
    │   ├── sqs.spec.ts
    │   ├── sns.spec.ts
    │   ├── dynamodb.spec.ts
    │   ├── lambda.spec.ts
    │   └── api-gateway.spec.ts
    │
    ├── api-explorer/
    │   └── api-explorer.spec.ts
    │
    ├── resources/
    │   └── resource-explorer.spec.ts
    │
    ├── architecture/
    │   └── architecture.spec.ts
    │
    ├── events/
    │   └── events.spec.ts
    │
    ├── logs/
    │   └── logs.spec.ts
    │
    └── scenarios/
        ├── payment-flow.spec.ts
        └── event-driven-flow.spec.ts
```

---

# 10. Playwright Configuration

Arquivo:

```text
playwright.config.ts
```

Configuração conceitual:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",

  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  reporter: [
    ["html"],
    ["list"],
  ],

  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
});
```

Inicialmente o projeto poderá focar em Chromium.

---

# 11. Test Environment

Antes dos testes:

```text
Docker
 ├── Floci
 ├── Go API
 └── Next.js
```

Depois:

```text
Playwright
      ↓
http://localhost:3000
```

O Playwright deverá utilizar o ambiente real do projeto.

---

# 12. Test Lifecycle

Fluxo:

```text
Start
  │
  ▼
Start Floci
  │
  ▼
Start Go API
  │
  ▼
Start Next.js
  │
  ▼
Run Playwright
  │
  ▼
Generate Report
  │
  ▼
Cleanup
```

---

# 13. Test Isolation

Cada cenário deverá possuir nomes de recursos únicos.

Exemplo:

```text
playwright-s3-{timestamp}
```

ou:

```text
e2e-s3-${process.env.TEST_RUN_ID}
```

Isso evita conflitos entre testes.

---

# 14. Test Data

Os dados utilizados nos testes deverão ser criados através da própria interface sempre que possível.

Exemplo:

```text
Playwright
   ↓
Create S3 Bucket
   ↓
Floci
```

Não criar recursos diretamente no banco interno da aplicação.

---

# 15. Testes do Dashboard

O Playwright deverá validar:

```text
Dashboard
 ├── Services
 ├── Resources
 ├── Regions
 ├── Recent Operations
 ├── LocalStack/Floci Status
 └── Favorites
```

Exemplo:

```typescript
test("dashboard should display Floci status", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(
    page.getByText("Floci")
  ).toBeVisible();

  await expect(
    page.getByText("Healthy")
  ).toBeVisible();
});
```

---

# 16. Testes de S3

Deverão existir cenários para:

```text
Create Bucket
List Buckets
Delete Bucket

Upload Object
Download Object
Delete Object

Object Metadata
Object Tags
Versioning
```

Fluxo:

```text
Create
 ↓
Verify
 ↓
Use
 ↓
Delete
 ↓
Verify deletion
```

---

# 17. Testes DynamoDB

Cenários:

```text
Create Table
Put Item
Get Item
Update Item
Delete Item
Query
Scan
Delete Table
```

Exemplo:

```text
Create table
     ↓
Insert item
     ↓
Search item
     ↓
Update item
     ↓
Delete item
```

---

# 18. Testes SQS

Cenários:

```text
Create Queue
Send Message
Receive Message
Delete Message
Purge Queue
Delete Queue
```

---

# 19. Testes SNS

Cenários:

```text
Create Topic
Create Subscription
Publish Message
Verify Delivery
Delete Subscription
Delete Topic
```

---

# 20. Testes Lambda

Cenários:

```text
Create Function
Configure Environment
Invoke Function
View Result
View Logs
Delete Function
```

---

# 21. Testes API Gateway

Cenários:

```text
Create API
Create Route
Configure Integration
Deploy
Invoke
Verify Response
Delete
```

---

# 22. Testes EventBridge

Cenários:

```text
Create Event Bus
Create Rule
Configure Target
Publish Event
Verify Target
Delete Rule
Delete Event Bus
```

---

# 23. Testes de API Explorer

O API Explorer deverá ser testado como usuário.

Exemplo:

```text
1. Open API Explorer
2. Select S3
3. Select ListBuckets
4. Execute
5. Inspect response
6. Verify HTTP status
7. Verify JSON response
```

---

# 24. Testes de Request Inspector

Deverá ser possível:

```text
Execute operation
      ↓
Open request
      ↓
Verify service
      ↓
Verify operation
      ↓
Verify parameters
      ↓
Verify response
```

---

# 25. Testes de Architecture Explorer

Após criar recursos:

```text
SQS
 ↓
Lambda
 ↓
DynamoDB
```

O Architecture Explorer deverá mostrar os nós.

Playwright deverá verificar:

```text
SQS visible
Lambda visible
DynamoDB visible
```

---

# 26. Testes de Resource Explorer

Validar:

```text
Search
Filter
Service
Region
Tags
Resource name
ARN
```

Exemplo:

```text
Search: payments

Expected:

payments-queue
payments-table
process-payments
```

---

# 27. Testes de Logs

Validar:

```text
Log appears
Filter by service
Filter by operation
Filter by status
Open log details
```

---

# 28. Testes de Events

Validar:

```text
Event appears
Correct service
Correct timestamp
Correct resource
Event relationship
```

---

# 29. Testes de erros

Os testes também deverão validar erros reais retornados pelo Floci.

Exemplo:

```text
Create bucket
       ↓
same bucket
       ↓
Floci
       ↓
BucketAlreadyExists
       ↓
UI displays error
```

O teste deverá verificar a mensagem apresentada ao usuário.

---

# 30. Testes de operações não suportadas

Quando uma operação não estiver disponível no Floci:

```text
Open service
     ↓
Open operation
     ↓
Execute
     ↓
UI reports unsupported operation
```

O sistema deverá diferenciar:

```text
Application Error
```

de:

```text
Floci Unsupported Operation
```

---

# 31. Service Registry

O backend deverá possuir um registry:

```text
Service
 ├── Metadata
 ├── Resources
 ├── Operations
 ├── Coverage
 └── UI capabilities
```

Exemplo:

```json
{
  "id": "s3",
  "name": "Amazon S3",
  "category": "Storage",
  "available": true
}
```

---

# 32. Generic Operation Engine

O backend deverá possuir um executor genérico:

```text
Service
   ↓
Operation
   ↓
Input
   ↓
AWS SDK
   ↓
Floci
   ↓
Output
```

Exemplo:

```json
{
  "service": "s3",
  "operation": "ListBuckets",
  "region": "us-east-1",
  "input": {}
}
```

---

# 33. Resource Discovery

O backend deverá conseguir descobrir recursos existentes.

Exemplo:

```text
S3
 └── Buckets

DynamoDB
 └── Tables

SQS
 └── Queues

Lambda
 └── Functions
```

O frontend utilizará essas informações para construir:

- tabelas;
- cards;
- detalhes;
- relacionamentos;
- busca global.

---

# 34. Frontend

Framework:

```text
Next.js
```

Utilizar:

```text
App Router
Server Components
Client Components
TypeScript
```

Estrutura:

```text
frontend/

├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   │
│   ├── dashboard/
│   ├── services/
│   ├── resources/
│   ├── api-explorer/
│   ├── architecture/
│   ├── events/
│   ├── logs/
│   ├── cli/
│   └── settings/
│
├── components/
│   ├── ui/
│   ├── layout/
│   ├── aws/
│   └── editors/
│
├── features/
│   ├── dashboard/
│   ├── services/
│   ├── resources/
│   ├── operations/
│   ├── architecture/
│   ├── events/
│   └── logs/
│
├── hooks/
├── lib/
├── stores/
├── types/
├── public/
│
├── next.config.ts
├── tsconfig.json
└── package.json
```

---

# 35. Backend

Go:

```text
backend/

├── cmd/
├── internal/
│   ├── api/
│   ├── aws/
│   ├── services/
│   ├── resources/
│   ├── operations/
│   ├── coverage/
│   ├── environments/
│   └── audit/
└── go.mod
```

---

# 36. API

Endpoints:

```text
GET    /api/v1/services
GET    /api/v1/services/:service
GET    /api/v1/services/:service/operations

POST   /api/v1/operations/execute

GET    /api/v1/resources
GET    /api/v1/resources/:service

GET    /api/v1/regions

GET    /api/v1/logs
GET    /api/v1/events

GET    /api/v1/health
GET    /api/v1/floci/status
```

---

# 37. Dashboard

O dashboard deverá possuir:

```text
Services
Resources
Regions
Recent Operations
Floci Status
Favorites
```

Exemplo:

```text
┌────────────────────────────────────────────────────┐
│ Search...              us-east-1    Floci ●        │
├──────────────┬─────────────────────────────────────┤
│              │                                     │
│ Dashboard    │ Welcome                             │
│              │                                     │
│ Services     │  Services    Resources    Regions   │
│              │     42          128          3      │
│ Resources    │                                     │
│              │ Recent Operations                   │
│ API Explorer │                                     │
│              │ S3 CreateBucket             200     │
│ Architecture │ SQS SendMessage             200     │
│              │ Lambda Invoke                200     │
│ Events       │                                     │
│              │                                     │
│ Logs         │                                     │
└──────────────┴─────────────────────────────────────┘
```

---

# 38. Service Explorer

Rota:

```text
/services
```

Categorias:

```text
Compute
Storage
Database
Networking
Security
Application Integration
Management
Analytics
```

---

# 39. Service Detail

Rota:

```text
/services/[service]
```

Exemplo:

```text
/services/s3
```

Tabs:

```text
Overview
Resources
Operations
API Explorer
Activity
Coverage
```

---

# 40. API Explorer

Rota:

```text
/api-explorer
```

Interface:

```text
Service
[ S3 ]

Operation
[ CreateBucket ]

Region
[ us-east-1 ]

Input

{
  "Bucket": "my-bucket"
}

[ Execute ]
```

Resultado:

```text
Status: 200
Duration: 14ms

Request
Response
Headers
Request ID
```

---

# 41. Architecture Explorer

Rota:

```text
/architecture
```

Utilizar:

```text
React Flow
```

Exemplo:

```text
┌─────────────┐
│ API Gateway │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Lambda    │
└──────┬──────┘
       │
 ┌─────┴─────┐
 ▼           ▼
SQS       DynamoDB
```

---

# 42. Global Search

Atalho:

```text
Ctrl + K
Cmd + K
```

Pesquisar:

```text
Services
Resources
Operations
ARN
Tags
Saved Operations
```

---

# 43. CLI

Rota:

```text
/cli
```

Utilizar:

```text
xterm.js
```

Exemplo:

```text
$ aws s3 ls

2026-09-25 my-bucket
2026-09-25 uploads
```

---

# 44. Environment

O ambiente padrão será:

```text
Floci
```

Configuração:

```env
FLOCI_ENDPOINT=http://localhost:4566

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

O endpoint deverá ser configurável.

---

# 45. Docker Compose

```yaml
services:

  floci:
    image: floci
    ports:
      - "4566:4566"

  backend:
    build: ./backend
    ports:
      - "8080:8080"
    environment:
      FLOCI_ENDPOINT: http://floci:4566
    depends_on:
      - floci

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8080
    depends_on:
      - backend
```

A imagem/nome exato do container do Floci deverá ser ajustado conforme a distribuição utilizada.

---

# 46. Scripts

## Makefile

```text
make up
make down
make logs
make build
make e2e
make e2e-ui
make e2e-report
make clean
```

## Frontend

```bash
pnpm dev
pnpm build
pnpm start
```

## Playwright

```bash
pnpm playwright test
```

Interface visual:

```bash
pnpm playwright test --ui
```

Relatório:

```bash
pnpm playwright show-report
```

---

# 47. CI

Pipeline:

```text
Checkout
   ↓
Install dependencies
   ↓
Build frontend
   ↓
Build backend
   ↓
Start Docker Compose
   ↓
Wait for Floci
   ↓
Wait for API
   ↓
Wait for Next.js
   ↓
Run Playwright
   ↓
Generate report
   ↓
Upload artifacts
```

Artifacts:

```text
playwright-report/
test-results/
screenshots/
videos/
traces/
```

---

# 48. E2E Scenarios

O projeto deverá possuir cenários completos.

## Scenario 1 — S3

```text
Create bucket
 ↓
Upload object
 ↓
View object
 ↓
Download object
 ↓
Delete object
 ↓
Delete bucket
```

## Scenario 2 — Queue

```text
Create queue
 ↓
Send message
 ↓
Receive message
 ↓
Delete message
 ↓
Delete queue
```

## Scenario 3 — DynamoDB

```text
Create table
 ↓
Put item
 ↓
Query item
 ↓
Update item
 ↓
Delete item
 ↓
Delete table
```

## Scenario 4 — Lambda

```text
Create function
 ↓
Invoke
 ↓
Inspect result
 ↓
Inspect logs
 ↓
Delete
```

## Scenario 5 — Event-driven architecture

```text
S3
 ↓
EventBridge
 ↓
SQS
 ↓
Lambda
 ↓
DynamoDB
```

Esse cenário deverá ser executado integralmente contra o Floci.

---

# 49. Testes de regressão

Todos os principais fluxos deverão ser executados pelo Playwright em cada alteração relevante.

Suite:

```text
Dashboard
Services
S3
SQS
SNS
DynamoDB
Lambda
API Gateway
EventBridge
Resource Explorer
API Explorer
Architecture
Logs
Events
```

---

# 50. Definition of Done

Uma funcionalidade será considerada concluída quando:

- [ ] UI implementada;
- [ ] integração com Go API implementada;
- [ ] operação executada contra Floci;
- [ ] estado retornado corretamente;
- [ ] erros tratados;
- [ ] loading state;
- [ ] empty state;
- [ ] integração com o restante da aplicação;
- [ ] cenário Playwright implementado;
- [ ] cenário Playwright executado com sucesso;
- [ ] nenhum mock substitui o serviço real do Floci.

---

# 51. MVP

O MVP deverá começar com:

```text
Frontend
────────
Next.js
TypeScript
Tailwind CSS
TanStack Query
Zustand
React Hook Form
Zod
Monaco
React Flow
xterm.js

Backend
───────
Go
AWS SDK v2

Runtime
───────
Floci
Docker Compose

Testing
───────
Playwright
```

Serviços iniciais:

```text
S3
SQS
SNS
DynamoDB
Lambda
API Gateway
```

---

# 52. Fluxo de desenvolvimento

A implementação deverá seguir:

```text
1. Criar feature
       ↓
2. Implementar UI Next.js
       ↓
3. Implementar endpoint Go
       ↓
4. Integrar AWS SDK
       ↓
5. Executar contra Floci
       ↓
6. Criar cenário Playwright
       ↓
7. Executar E2E
       ↓
8. Feature concluída
```

---

# 53. Arquitetura final

```text
                         ┌───────────────┐
                         │    Browser    │
                         └───────┬───────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │       Next.js       │
                      │                     │
                      │ App Router          │
                      │ React               │
                      │ TypeScript          │
                      │ TanStack Query      │
                      │ Zustand             │
                      │ Monaco              │
                      │ React Flow          │
                      │ xterm.js            │
                      └──────────┬──────────┘
                                 │
                                 │ HTTP
                                 ▼
                      ┌─────────────────────┐
                      │       Go API        │
                      │                     │
                      │ Service Registry    │
                      │ Operation Engine    │
                      │ Resource Explorer   │
                      │ Coverage Engine     │
                      │ Audit               │
                      └──────────┬──────────┘
                                 │
                                 │ AWS SDK v2
                                 ▼
                      ┌─────────────────────┐
                      │       Floci         │
                      │                     │
                      │ S3                  │
                      │ SQS                 │
                      │ SNS                 │
                      │ DynamoDB            │
                      │ Lambda              │
                      │ API Gateway         │
                      │ EventBridge         │
                      │ ECS                 │
                      │ EC2                 │
                      │ RDS                 │
                      │ ...                 │
                      └─────────────────────┘


                    E2E Validation
                          │
                          ▼
                    ┌─────────────┐
                    │  Playwright │
                    └──────┬──────┘
                           │
                           ▼
                       Browser
                           │
                           ▼
                       Next.js
                           │
                           ▼
                        Go API
                           │
                           ▼
                         Floci
```

---

# 54. Decisões tecnológicas finais

| Área | Tecnologia |
|---|---|
| Frontend | Next.js |
| Linguagem frontend | TypeScript |
| UI | React |
| CSS | Tailwind CSS |
| Server state | TanStack Query |
| Client state | Zustand |
| Forms | React Hook Form + Zod |
| JSON/YAML | Monaco Editor |
| Architecture Graph | React Flow |
| Terminal | xterm.js |
| Backend | Go |
| AWS SDK | AWS SDK for Go v2 |
| AWS Runtime | Floci |
| Containers | Docker |
| Orquestração local | Docker Compose |
| E2E | Playwright |
| Testes unitários | **Não utilizar** |

---

# 55. Princípio final

O projeto não deverá ser construído como um conjunto de telas mockadas de serviços AWS.

A arquitetura deverá ser:

```text
                 ┌─────────────────┐
                 │     Next.js     │
                 │   AWS Console   │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │      Go API     │
                 │  AWS SDK v2     │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │      Floci      │
                 │ AWS Environment │
                 └─────────────────┘
```

O **Playwright deverá validar o comportamento do sistema inteiro**, desde a interação do usuário no browser até a alteração efetiva do recurso no Floci.

A prioridade do projeto será:

```text
Funcionalidade real
       ↓
Integração real
       ↓
Floci
       ↓
E2E Playwright
       ↓
Regressão
```

Não haverá uma suíte separada de testes unitários como requisito do projeto.
