// TEST-ID: TP-<项目编号>-L2-001
// TEST-NAME: <接口测试名称>
// TEST-LEVEL: L2
// TEST-TARGET: <HTTP方法 路径> 例: GET /api/users
// TEST-PREREQUISITE: 服务已启动，数据库已初始化，第三方服务已 mock
// TEST-STEPS: 构造请求 -> 发送 -> 验证状态码和响应体
// TEST-EXPECTED: HTTP 200，响应体符合接口定义

// === Java (REST Assured + Spring Boot Test) 示例 ===
// import io.restassured.RestAssured;
// import org.junit.jupiter.api.*;
// import org.springframework.boot.test.context.SpringBootTest;
//
// @SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
// class UserApiTest {
//     @Test
//     void shouldReturn200_whenGetUsers() {
//         RestAssured.given()
//             .contentType("application/json")
//         .when()
//             .get("/api/users")
//         .then()
//             .statusCode(200)
//             .body("code", equalTo(200));
//     }
//
//     @Test
//     void shouldReturn201_whenCreateUser() {
//         String body = "{\"username\":\"test\",\"password\":\"123456\"}";
//         RestAssured.given()
//             .contentType("application/json")
//             .body(body)
//         .when()
//             .post("/api/users")
//         .then()
//             .statusCode(201);
//     }
// }

// === Python (pytest + requests) 示例 ===
// # import pytest
// # import requests
// #
// # BASE_URL = "http://localhost:8080"
// #
// # def test_should_return_200_when_get_users():
// #     response = requests.get(f"{BASE_URL}/api/users")
// #     assert response.status_code == 200
// #     assert response.json()["code"] == 200
// #
// # def test_should_return_201_when_create_user():
// #     payload = {"username": "test", "password": "123456"}
// #     response = requests.post(f"{BASE_URL}/api/users", json=payload)
// #     assert response.status_code == 201

// === JavaScript (Supertest) 示例 ===
// # const request = require('supertest');
// # const app = require('../app');
// #
// # test('GET /api/users should return 200', async () => {
// #     const res = await request(app).get('/api/users');
// #     expect(res.status).toBe(200);
// # });
