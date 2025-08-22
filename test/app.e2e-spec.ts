import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(600000);

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let testUserId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply the same pipes used in the main application
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();

    // Setup test user and get auth token
    await setupTestUser();
  });

  afterEach(async () => {
    await app.close();
  });

  const setupTestUser = async () => {
    // Create test user
    const userResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'test@example.com',
        password: 'testpass123',
        name: 'Test User',
        role: 'USER'
      });

    testUserId = userResponse.body.id;

    // Login to get auth token
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'test@example.com',
        password: 'testpass123'
      });

    authToken = loginResponse.body.access_token;
  };

  it('/ (GET) - should be protected', () => {
    return request(app.getHttpServer()).get('/').expect(401);
  });

  describe('Tasks API', () => {
    it('should create a normal task successfully', async () => {
      const taskData = {
        title: 'Test Task',
        description: 'A normal task',
        status: 'PENDING',
        priority: 'MEDIUM',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        userId: testUserId
      };

      const response = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(taskData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe('PENDING');
      expect(response.body.title).toBe(taskData.title);
    });

    it('should create an overdue task and update status immediately', async () => {
      const overdueTaskData = {
        title: 'Overdue Task',
        description: 'This task is overdue',
        status: 'PENDING',
        priority: 'HIGH',
        dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
        userId: testUserId
      };

      const response = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(overdueTaskData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe('IN_PROGRESS'); // Should be updated immediately
      expect(response.body.title).toBe(overdueTaskData.title);
    });

    it('should get tasks with pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/tasks?page=1&limit=5')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('limit');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should get task statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/tasks/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('completed');
      expect(response.body).toHaveProperty('inProgress');
      expect(response.body).toHaveProperty('pending');
      expect(response.body).toHaveProperty('highPriority');
    });
  });

  describe('Authentication', () => {
    it('should reject requests without auth token', () => {
      return request(app.getHttpServer())
        .get('/tasks')
        .expect(401);
    });

    it('should reject requests with invalid auth token', () => {
      return request(app.getHttpServer())
        .get('/tasks')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });
});
