"""
pymorphy2 兼容性补丁
修复 Python 3.11+ 中 inspect.getargspec 被移除的问题
"""
import inspect

if not hasattr(inspect, 'getargspec'):
    # 为 Python 3.11+ 添加 getargspec 兼容性
    def getargspec(func):
        """兼容 Python 3.11+ 的 getargspec 实现"""
        try:
            spec = inspect.getfullargspec(func)
            # 创建一个类似 ArgSpec 的命名元组
            from collections import namedtuple
            ArgSpec = namedtuple('ArgSpec', 'args varargs keywords defaults')
            return ArgSpec(spec.args, spec.varargs, spec.varkw, spec.defaults)
        except Exception:
            # 如果 getfullargspec 也失败，返回一个空的 spec
            from collections import namedtuple
            ArgSpec = namedtuple('ArgSpec', 'args varargs keywords defaults')
            return ArgSpec([], None, None, None)
    
    inspect.getargspec = getargspec

print("✓ pymorphy2 兼容性补丁已加载")
