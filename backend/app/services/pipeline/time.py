"""时间解析模型工具：把用户提问里的中文时间表达解析成可写进 SQL 的明确日期区间。

模型经常遇到「六月份的入场煤量」「最近30天」「上个月」这类相对/模糊时间，
直接猜会造成 SQL 日期区间错误。这个工具让模型先调用它拿到明确日期，
再据此写 WHERE 条件（约定左闭右开：date >= 'YYYY-MM-DD' AND date < 'YYYY-MM-DD'）。

与 clarify / render_chart 不同，本工具是「真正执行」的纯计算工具（不读库、无副作用）。
"""

from __future__ import annotations

import re
from calendar import monthrange
from datetime import date, datetime, timedelta

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

TIME_TOOL_NAME = "resolve_time_range"


class TimeRangeInput(BaseModel):
    """时间解析工具的入参。"""

    expression: str = Field(
        description=(
            "要解析的、来自用户问题的中文时间表达。示例：'2025年6月'、'2025-06'、'6月'、'6月份'、"
            "'2025年'、'今年'、'去年'、'本月'、'上月'、'本周'、'最近30天'。"
            "只给月份时默认取当前年份；给出的日期区间按左闭右开返回。"
        ),
    )


# 中文数字月份（一月~十二月）
_CN_MONTHS = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6,
    "七": 7, "八": 8, "九": 9, "十": 10, "十一": 11, "十二": 12,
    "正": 1, "腊": 12, "冬": 11,
}


def _cn_to_int(text: str) -> int | None:
    """把中文数字/数字串转成 int；失败返回 None。"""
    if text.isdigit():
        return int(text)
    # 中文数字（支持 十一 / 十二 / 二十 等简单组合）
    if text in _CN_MONTHS:
        return _CN_MONTHS[text]
    return None


def _fmt(d: date) -> str:
    return d.isoformat()


def _month_range(year: int, month: int) -> tuple[date, date]:
    """返回某月的 [当月首日, 次月首日) 左闭右开区间。"""
    start = date(year, month, 1)
    end_year = year + (month // 12)
    end_month = month % 12 + 1
    return start, date(end_year, end_month, 1)


def _parse_year_month(expression: str, current_year: int) -> tuple[int, int] | None:
    """从表达式里解析 (年, 月)。支持 2025-06 / 2025年6月 / 06月 / 六月 等。"""
    s = expression.strip()
    if not s:
        return None

    # 带年份：YYYY[年\-/\.]M(月)?  或  YYYY年M月
    m = re.search(r"(20\d{2})\s*[年\-/\.]\s*(\d{1,2}|[一二三四五六七八九十]+)\s*月?", s)
    if m:
        year = int(m.group(1))
        month = _cn_to_int(m.group(2))
        if month and 1 <= month <= 12:
            return year, month
        return None

    # 无年份：MM月 / 六月  → 用当前年份
    m = re.search(r"(\d{1,2}|[一二三四五六七八九十]+)\s*月", s)
    if m:
        month = _cn_to_int(m.group(1))
        if month and 1 <= month <= 12:
            return current_year, month
        return None
    return None


def _relative_range(expression: str, today: date) -> tuple[date, date] | None:
    """解析常见相对时间，返回 [起始日, 结束日]（结束日含当天）。"""
    s = expression.strip().replace(" ", "")
    if s in ("今天", "今日"):
        return today, today
    if s in ("昨天", "昨日"):
        y = today - timedelta(days=1)
        return y, y
    if s in ("明天", "明日"):
        y = today + timedelta(days=1)
        return y, y
    if s in ("本周", "这周"):
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if s in ("上周",):
        end = today - timedelta(days=today.weekday() + 1)
        return end - timedelta(days=6), end
    if s in ("上月", "上个月"):
        end = today.replace(day=1) - timedelta(days=1)
        return end.replace(day=1), end
    if s in ("本月", "这个月", "这个月份"):
        return today.replace(day=1), today
    if s in ("今年", "本年"):
        return date(today.year, 1, 1), today
    if s in ("去年", "上年"):
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)
    if s in ("明年", "下一年"):
        return date(today.year + 1, 1, 1), date(today.year + 1, 12, 31)

    # 最近N天 / 近N天 / 过去N天
    m = re.search(r"(?:最近|近|过去)\s*(\d+)\s*天", s)
    if m:
        n = int(m.group(1))
        return today - timedelta(days=n - 1), today

    # 最近N个月 / 近N月
    m = re.search(r"(?:最近|近|过去)\s*(\d+)\s*个?月", s)
    if m:
        n = int(m.group(1))
        start = today.replace(day=1)
        start_year = start.year - ((n - 1) // 12)
        start_month = ((start.month - 1 - (n - 1)) % 12) + 1
        return date(start_year, start_month, 1), today
    return None


def _resolve(expression: str, today: date) -> tuple[str, str, str]:
    """返回 (说明文本, 左闭区间起点, 右开区间终点)。"""
    # 纯年份：2025 / 2025年
    m = re.fullmatch(r"\s*(20\d{2})\s*年?\s*", expression)
    if m:
        year = int(m.group(1))
        return (f"{year}年", f"{year}-01-01", f"{year + 1}-01-01")

    # 年份-月份
    ym = _parse_year_month(expression, today.year)
    if ym:
        year, month = ym
        start, exclusive_end = _month_range(year, month)
        return (
            f"{year}年{month}月（{_fmt(start)} ~ {_fmt(exclusive_end - timedelta(days=1))}）",
            _fmt(start),
            _fmt(exclusive_end),
        )

    # 相对区间
    rel = _relative_range(expression, today)
    if rel:
        start, end_incl = rel
        return (
            f"{expression}（{_fmt(start)} ~ {_fmt(end_incl)}）",
            _fmt(start),
            _fmt(end_incl + timedelta(days=1)),
        )

    return expression, "", ""


def _time_fn(expression: str) -> str:
    """真正执行：解析时间表达并返回可直接用于 SQL 的日期区间说明。"""
    today = datetime.now().date()
    label, start, excl_end = _resolve(expression or "", today)
    if not start:
        return (
            f"无法解析时间表达「{expression}」。请改用明确的年份/月份，例如 '2025-06'、'2025年6月'、"
            "'今年'、'最近30天'。"
        )
    return (
        f"已解析「{expression}」→ {label}\n"
        f"写 SQL 用左闭右开区间：date >= '{start}' AND date < '{excl_end}'"
    )


def make_time_tool() -> StructuredTool:
    """构造时间解析工具，供模型在写日期过滤前调用。"""
    return StructuredTool.from_function(
        func=_time_fn,
        name=TIME_TOOL_NAME,
        description=(
            "当你需要根据用户问题里的时间表达（如 '6月'、'今年'、'上个月'、'最近30天'）写 SQL 日期条件时，"
            "先调用它把表达解析成明确的日期范围。它返回可直接用于 WHERE 的左闭右开区间。"
        ),
        args_schema=TimeRangeInput,
    )


# 供单测/复用：导出纯解析
resolve = _resolve
