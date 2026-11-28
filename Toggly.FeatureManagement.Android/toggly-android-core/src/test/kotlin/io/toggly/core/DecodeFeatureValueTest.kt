package io.toggly.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * Covers [decodeDateTimeValue]'s ISO-8601 soft-decode semantics (OPS-2102
 * review finding): timezone minute offsets must survive parsing, and a
 * partially-matched string must soft-null rather than silently truncate.
 */
class DecodeFeatureValueTest {

    private fun utcCalendar(value: java.util.Date): Calendar =
        Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = value }

    @Test
    fun `decodeDateTimeValue preserves a colon-separated minute offset`() {
        // 04:35 UTC+05:30 == 23:05 UTC the previous day.
        val result = decodeDateTimeValue("2026-06-01T04:35:00+05:30", "datetime")

        requireNotNull(result)
        val cal = utcCalendar(result)
        assertEquals(2026, cal.get(Calendar.YEAR))
        assertEquals(Calendar.MAY, cal.get(Calendar.MONTH))
        assertEquals(31, cal.get(Calendar.DAY_OF_MONTH))
        assertEquals(23, cal.get(Calendar.HOUR_OF_DAY))
        assertEquals(5, cal.get(Calendar.MINUTE))
    }

    @Test
    fun `decodeDateTimeValue preserves a negative minute offset without colon`() {
        // 10:00 UTC-04:30 == 14:30 UTC.
        val result = decodeDateTimeValue("2026-06-01T10:00:00-0430", "datetime")

        requireNotNull(result)
        val cal = utcCalendar(result)
        assertEquals(2026, cal.get(Calendar.YEAR))
        assertEquals(Calendar.JUNE, cal.get(Calendar.MONTH))
        assertEquals(1, cal.get(Calendar.DAY_OF_MONTH))
        assertEquals(14, cal.get(Calendar.HOUR_OF_DAY))
        assertEquals(30, cal.get(Calendar.MINUTE))
    }

    @Test
    fun `decodeDateTimeValue parses a literal Z suffix as UTC`() {
        val result = decodeDateTimeValue("2026-06-01T00:00:00Z", "datetime")

        requireNotNull(result)
        val cal = utcCalendar(result)
        assertEquals(2026, cal.get(Calendar.YEAR))
        assertEquals(Calendar.JUNE, cal.get(Calendar.MONTH))
        assertEquals(1, cal.get(Calendar.DAY_OF_MONTH))
        assertEquals(0, cal.get(Calendar.HOUR_OF_DAY))
    }

    @Test
    fun `decodeDateTimeValue soft-nulls trailing garbage instead of truncating`() {
        // A naive SimpleDateFormat#parse(String) call silently ignores the
        // unparsed "garbage" suffix instead of failing; full consumption
        // must be required.
        val result = decodeDateTimeValue("2026-06-01T00:00:00Zgarbage", "datetime")

        assertNull(result)
    }

    @Test
    fun `decodeDateTimeValue soft-nulls an unparsable string`() {
        assertNull(decodeDateTimeValue("not-a-date", "datetime"))
    }

    @Test
    fun `decodeDateTimeValue soft-nulls on declared valueType mismatch`() {
        assertNull(decodeDateTimeValue("2026-06-01T00:00:00Z", "string"))
    }
}
