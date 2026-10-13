import os

# 内网服务（LLM / Embedding）一律直连、不经代理。
# 本机环境变量带 HTTP_PROXY=http://127.0.0.1:7897，且 NO_PROXY 里的 IPv6 条目（::1,[::1]）
# 会让 httpx/httpx2 解析代理 URL 崩溃（Invalid port: ':1]'），或把内网请求也丢给本地代理 → 502。
# 因此在应用启动最早处清掉所有代理相关环境变量，让进程内任何 HTTP 客户端都直连。
for _proxy_key in (
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "FTP_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "ftp_proxy",
    "NO_PROXY", "no_proxy",
):
    os.environ.pop(_proxy_key, None)

# JWT
SECRET_KEY = os.getenv("ASK_DATA_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day

# 记忆存储 PostgreSQL（本地 Docker，askdata_memory 库）
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://askdata:askdata@localhost:5432/askdata_memory",
)

# mock 阶段的内置演示账号
#   email: demo@askdata.dev
#   password: demo123456
DEMO_USERS = {
    "demo@askdata.dev": {
        "password": "demo123456",
        "name": "DeepData Demo",
        "plan": "free",
    }
}
