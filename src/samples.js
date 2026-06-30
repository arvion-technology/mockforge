// Sample specs shipped with the demo.
//
// They live in src/ rather than demo/ so the CLI examples, the tests and the
// in-browser playground all read the same documents. examples/tasks.yaml is
// the same spec on disk for `mockforge serve`; a test asserts the two parse to
// identical documents so the copy cannot drift.

export const TASKS_SPEC = `openapi: 3.0.3
info:
  title: Task Tracker API
  version: 1.2.0
  description: A small task-tracking API used to exercise MockForge.
servers:
  - url: https://api.example.com/v1
paths:
  /tasks:
    get:
      summary: List tasks
      operationId: listTasks
      tags: [tasks]
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [todo, in_progress, done]
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 50
      responses:
        "200":
          description: All tasks
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Task"
    post:
      summary: Create a task
      operationId: createTask
      tags: [tasks]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/TaskInput"
      responses:
        "201":
          description: Created task
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Task"
  /tasks/{taskId}:
    parameters:
      - name: taskId
        in: path
        required: true
        schema:
          type: string
    get:
      summary: Get one task
      operationId: getTask
      tags: [tasks]
      responses:
        "200":
          description: The task
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Task"
        "404":
          description: Missing
    patch:
      summary: Update a task
      operationId: updateTask
      tags: [tasks]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/TaskUpdate"
      responses:
        "200":
          description: Updated task
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Task"
    delete:
      summary: Delete a task
      operationId: deleteTask
      tags: [tasks]
      responses:
        "204":
          description: Deleted
components:
  schemas:
    Task:
      type: object
      required: [id, title, status, priority, createdAt]
      properties:
        id:
          type: string
        title:
          type: string
          minLength: 3
          maxLength: 80
        description:
          type: string
        status:
          type: string
          enum: [todo, in_progress, done]
        priority:
          type: integer
          minimum: 1
          maximum: 5
        assignee:
          type: string
          nullable: true
        tags:
          type: array
          items:
            type: string
          maxItems: 5
        estimateHours:
          type: number
          minimum: 0
          maximum: 40
        createdAt:
          type: string
          format: date-time
    TaskInput:
      type: object
      required: [title]
      additionalProperties: false
      properties:
        title:
          type: string
          minLength: 3
          maxLength: 80
        description:
          type: string
        status:
          type: string
          enum: [todo, in_progress, done]
        priority:
          type: integer
          minimum: 1
          maximum: 5
        assignee:
          type: string
          nullable: true
        tags:
          type: array
          items:
            type: string
    TaskUpdate:
      type: object
      properties:
        title:
          type: string
          minLength: 3
          maxLength: 80
        description:
          type: string
        status:
          type: string
          enum: [todo, in_progress, done]
        priority:
          type: integer
          minimum: 1
          maximum: 5
        assignee:
          type: string
          nullable: true
`;

export const ORDERS_SPEC = `openapi: 3.0.3
info:
  title: Order Service API
  version: 0.9.0
  description: Checkout and fulfilment endpoints for a storefront.
servers:
  - url: https://orders.example.com
paths:
  /orders:
    get:
      summary: List orders
      operationId: listOrders
      parameters:
        - name: state
          in: query
          schema:
            type: string
            enum: [pending, paid, shipped, cancelled]
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 25
      responses:
        "200":
          description: Orders
          content:
            application/json:
              schema:
                type: object
                required: [items, total]
                properties:
                  items:
                    type: array
                    items:
                      $ref: "#/components/schemas/Order"
                  total:
                    type: integer
                  limit:
                    type: integer
    post:
      summary: Place an order
      operationId: placeOrder
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/OrderInput"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Order"
  /orders/{orderId}:
    parameters:
      - name: orderId
        in: path
        required: true
        schema:
          type: string
    get:
      summary: Get an order
      operationId: getOrder
      responses:
        "200":
          description: Order
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Order"
components:
  schemas:
    Order:
      type: object
      required: [id, reference, customer, state, total, createdAt]
      properties:
        id:
          type: string
        reference:
          type: string
          format: uuid
        customer:
          type: string
        email:
          type: string
          format: email
        state:
          type: string
          enum: [pending, paid, shipped, cancelled]
        total:
          type: number
          minimum: 1
          maximum: 5000
        currency:
          type: string
          enum: [USD, EUR, NPR]
        createdAt:
          type: string
          format: date-time
    OrderInput:
      type: object
      required: [customer, email, total]
      properties:
        customer:
          type: string
        email:
          type: string
          format: email
        total:
          type: number
          minimum: 1
          maximum: 5000
        currency:
          type: string
          enum: [USD, EUR, NPR]
`;

export const SAMPLE_SPECS = [
  {
    id: "tasks",
    name: "Task Tracker",
    blurb: "Array response, nested schema, path + query validation",
    yaml: TASKS_SPEC,
  },
  {
    id: "orders",
    name: "Order Service",
    blurb: "Wrapped list response, object ids, enum filters",
    yaml: ORDERS_SPEC,
  },
];

export const sampleById = (id) => SAMPLE_SPECS.find((sample) => sample.id === id) || SAMPLE_SPECS[0];
