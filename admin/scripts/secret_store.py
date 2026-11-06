"""Protect model credentials with the current Windows user's DPAPI profile.

Input and output use anonymous pipes. No credential is accepted in arguments,
written to a temporary file, or included in an error message.
"""
import base64
import ctypes
from ctypes import wintypes
import json
import sys


class Blob(ctypes.Structure):
    _fields_ = [("length", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def transform(operation, value):
    if sys.platform != "win32":
        raise RuntimeError("Windows credential protection is required")
    if operation not in {"protect", "unprotect"} or not isinstance(value, str) or len(value) > 16000:
        raise ValueError("Invalid credential request")
    raw = value.encode("utf-8") if operation == "protect" else base64.b64decode(value, validate=True)
    source_buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    entropy_buffer = ctypes.create_string_buffer(b"AI-WQS-model-settings-v1")
    entropy = Blob(len(entropy_buffer.raw) - 1, ctypes.cast(entropy_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    function = crypt32.CryptProtectData if operation == "protect" else crypt32.CryptUnprotectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p,
                         ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(source), None, ctypes.byref(entropy), None, None, 1, ctypes.byref(output)):
        raise RuntimeError("Windows credential protection failed")
    try:
        result = ctypes.string_at(output.data, output.length)
        return base64.b64encode(result).decode("ascii") if operation == "protect" else result.decode("utf-8")
    finally:
        if output.data:
            kernel32.LocalFree(ctypes.cast(output.data, ctypes.c_void_p))
        ctypes.memset(source_buffer, 0, len(source_buffer))


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        text = sys.stdin.read(20000)
        request = json.loads(text)
        print(json.dumps({"value": transform(request["operation"], request["value"])}))
    except Exception:
        print(json.dumps({"error": "无法使用当前 Windows 用户保护或读取密钥。"}))
        sys.exit(1)
