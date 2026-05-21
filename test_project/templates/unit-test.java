// TEST-ID: TP-<项目编号>-L1-001
// TEST-NAME: <测试名称>
// TEST-LEVEL: L1
// TEST-TARGET: <目标类.方法>
// TEST-PREREQUISITE: 无外部依赖，使用 mock 隔离
// TEST-STEPS: 输入X -> 调用方法 -> 验证输出
// TEST-EXPECTED: 返回值符合预期，边界条件正确处理

// === Java (JUnit5 + Mockito) 示例 ===
// import org.junit.jupiter.api.*;
// import org.mockito.Mockito;
//
// class ExampleTest {
//     @Test
//     void shouldReturnExpectedValue_whenInputIsValid() {
//         // Given
//         Dependency dep = Mockito.mock(Dependency.class);
//         Mockito.when(dep.getData()).thenReturn("mock-data");
//         TargetClass target = new TargetClass(dep);
//
//         // When
//         String result = target.process("input");
//
//         // Then
//         Assertions.assertEquals("expected", result);
//     }
// }

// === Python (pytest) 示例 ===
// # from unittest.mock import Mock
// #
// # def test_should_return_expected_value(mocker):
// #     dep = Mock()
// #     dep.get_data.return_value = "mock-data"
// #     target = TargetClass(dep)
// #
// #     result = target.process("input")
// #
// #     assert result == "expected"

// === JavaScript (Jest) 示例 ===
// # const { TargetClass } = require('./target');
// #
// # test('should return expected value when input is valid', () => {
// #     const dep = { getData: jest.fn().mockReturnValue('mock-data') };
// #     const target = new TargetClass(dep);
// #
// #     const result = target.process('input');
// #
// #     expect(result).toBe('expected');
// # });
