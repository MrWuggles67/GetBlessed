package com.getblessed.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class ApiException(message: String) : Exception(message)

data class Session(val token: String, val role: String, val name: String)

data class BillSummary(val id: Long, val merchant: String, val total: Double, val status: String, val ownerName: String, val imageUrl: String, val blessed: Double)

data class BillDetail(val summary: BillSummary, val items: List<BillItem>)

/** Blocking calls; invoke from a background thread. */
object Api {
    private val client = OkHttpClient()
    private val json = "application/json".toMediaType()
    var token: String? = null

    private fun call(req: Request.Builder): JSONObject {
        token?.let { req.header("Authorization", "Bearer " + it) }
        client.newCall(req.build()).execute().use { r ->
            val body = JSONObject(r.body?.string().takeUnless { it.isNullOrBlank() } ?: "{}")
            if (!r.isSuccessful) throw ApiException(body.optString("error", "Request failed (${r.code})"))
            return body
        }
    }

    private fun url(path: String) = BuildConfig.API_URL + path

    private fun session(o: JSONObject): Session {
        val u = o.getJSONObject("user")
        token = o.getString("token")
        return Session(token!!, u.getString("role"), u.getString("name"))
    }

    fun login(email: String, password: String) = session(call(Request.Builder().url(url("/api/auth/login"))
        .post(JSONObject().put("email", email).put("password", password).toString().toRequestBody(json))))

    fun signup(role: String, name: String, email: String, password: String, annualIncome: Double?): Session {
        val b = JSONObject().put("name", name).put("email", email).put("password", password)
        if (annualIncome != null) b.put("annualIncome", annualIncome)
        return session(call(Request.Builder().url(url("/api/auth/signup/$role")).post(b.toString().toRequestBody(json))))
    }

    private fun summary(o: JSONObject) = BillSummary(
        o.getLong("id"), o.optString("merchant", "").takeIf { it != "null" && it.isNotEmpty() } ?: "Bill #${o.getLong("id")}",
        o.getDouble("total"), o.getString("status"), o.optString("owner_name"), url(o.getString("imageUrl")), o.optDouble("blessed_amount", 0.0))

    fun bills(): List<BillSummary> {
        val a: JSONArray = call(Request.Builder().url(url("/api/bills")).get()).getJSONArray("bills")
        return (0 until a.length()).map { summary(a.getJSONObject(it)) }
    }

    fun bill(id: Long): BillDetail {
        val o = call(Request.Builder().url(url("/api/bills/$id")).get())
        val a = o.getJSONArray("items")
        return BillDetail(summary(o), (0 until a.length()).map { val i = a.getJSONObject(it); BillItem(i.getString("name"), i.getInt("quantity"), i.getDouble("price")) })
    }

    fun uploadBill(image: ByteArray, mime: String, bill: ParsedBill) {
        val items = JSONArray(bill.items.map { JSONObject().put("name", it.name).put("quantity", it.quantity).put("price", it.price) })
        val ext = if (mime == "image/png") "png" else "jpg"
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("merchant", bill.merchant ?: "")
            .addFormDataPart("items", items.toString())
            .addFormDataPart("image", "bill.$ext", image.toRequestBody(mime.toMediaType()))
            .build()
        call(Request.Builder().url(url("/api/bills")).post(form))
    }

    fun bless(billId: Long, amount: Double, message: String) {
        call(Request.Builder().url(url("/api/bills/$billId/bless"))
            .post(JSONObject().put("amount", amount).put("message", message).toString().toRequestBody(json)))
    }
}
