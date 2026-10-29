package com.getblessed.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.coroutines.resume

private fun money(v: Double) = String.format(Locale.US, "$%,.2f", v)

private val colors = lightColorScheme(primary = androidx.compose.ui.graphics.Color(0xFF4F46E5))

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = colors) { Surface(Modifier.fillMaxSize()) { App() } } }
    }
}

enum class Screen { Login, SignupBillable, SignupBlessings, Home, Upload, Detail }

@Composable
fun App() {
    var screen by remember { mutableStateOf(Screen.Login) }
    var session by remember { mutableStateOf<Session?>(null) }
    var selected by remember { mutableStateOf(0L) }
    val onAuth: (Session) -> Unit = { session = it; screen = Screen.Home }
    when (screen) {
        Screen.Login -> LoginScreen(onAuth, { screen = Screen.SignupBillable }, { screen = Screen.SignupBlessings })
        Screen.SignupBillable -> SignupScreen("billable", onAuth) { screen = Screen.Login }
        Screen.SignupBlessings -> SignupScreen("blessings", onAuth) { screen = Screen.Login }
        Screen.Home -> HomeScreen(session!!, { selected = it; screen = Screen.Detail }, { screen = Screen.Upload }) {
            Api.token = null; session = null; screen = Screen.Login
        }
        Screen.Upload -> UploadScreen { screen = Screen.Home }
        Screen.Detail -> DetailScreen(selected, session!!.role == "blessings") { screen = Screen.Home }
    }
}

@Composable
private fun Page(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        content()
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, password: Boolean = false) =
    OutlinedTextField(value, onChange, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None)

/** Runs a blocking API call off the main thread, reporting errors as a message. */
@Composable
private fun rememberRunner(): (suspend () -> Unit, (String) -> Unit) -> Unit {
    val scope = rememberCoroutineScope()
    return { block, onError ->
        scope.launch {
            try { withContext(Dispatchers.IO) { block() } } catch (e: Exception) { onError(e.message ?: "Something went wrong") }
        }
    }
}

@Composable
fun LoginScreen(onAuth: (Session) -> Unit, toBillable: () -> Unit, toBlessings: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    val run = rememberRunner()
    Page("Welcome to GetBlessed") {
        Text("Sign in to continue", color = MaterialTheme.colorScheme.outline)
        Field(email, { email = it }, "Email")
        Field(password, { password = it }, "Password", true)
        if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        Button({ run({ val s = Api.login(email.trim(), password); withContext(Dispatchers.Main) { onAuth(s) } }, { error = it }) }, Modifier.fillMaxWidth()) { Text("Sign in") }
        HorizontalDivider()
        OutlinedButton(toBillable, Modifier.fillMaxWidth()) { Text("I need help with a bill — sign up") }
        OutlinedButton(toBlessings, Modifier.fillMaxWidth()) { Text("I want to bless others — sign up") }
    }
}

@Composable
fun SignupScreen(role: String, onAuth: (Session) -> Unit, back: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var income by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    val run = rememberRunner()
    val blessings = role == "blessings"
    Page(if (blessings) "Become a Blessing" else "Create a Billable account") {
        Text(if (blessings) "See every posted bill and help pay it off." else "Post your bills and let others bless you.", color = MaterialTheme.colorScheme.outline)
        Field(name, { name = it }, "Full name")
        Field(email, { email = it }, "Email")
        Field(password, { password = it }, "Password (8+ characters)", true)
        if (blessings) Field(income, { income = it.filter { c -> c.isDigit() || c == '.' } }, "Yearly income ($)")
        if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        Button({
            val amount = income.toDoubleOrNull()
            if (blessings && amount == null) error = "Enter your yearly income"
            else run({ val s = Api.signup(role, name.trim(), email.trim(), password, if (blessings) amount else null); withContext(Dispatchers.Main) { onAuth(s) } }, { error = it })
        }, Modifier.fillMaxWidth()) { Text("Sign up") }
        TextButton(back) { Text("Back to sign in") }
    }
}

@Composable
fun HomeScreen(session: Session, open: (Long) -> Unit, upload: () -> Unit, logout: () -> Unit) {
    var bills by remember { mutableStateOf<List<BillSummary>?>(null) }
    var error by remember { mutableStateOf("") }
    val run = rememberRunner()
    val billable = session.role == "billable"
    LaunchedEffect(Unit) { run({ val b = Api.bills(); withContext(Dispatchers.Main) { bills = b } }, { error = it }) }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text(if (billable) "My bills" else "Bills to bless", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text("Hello, ${session.name}", color = MaterialTheme.colorScheme.outline)
            }
            TextButton(logout) { Text("Sign out") }
        }
        if (billable) Button(upload, Modifier.fillMaxWidth()) { Text("Upload a bill") }
        if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        val list = bills
        if (list == null) CircularProgressIndicator() else if (list.isEmpty()) Text("No bills yet.")
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(list ?: emptyList()) { b ->
                Card(Modifier.fillMaxWidth().clickable { open(b.id) }) {
                    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) {
                            Text(b.merchant, fontWeight = FontWeight.SemiBold)
                            Text(if (billable) b.status else "by ${b.ownerName}", color = MaterialTheme.colorScheme.outline)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(money(b.total), fontWeight = FontWeight.Bold)
                            Text("blessed ${money(b.blessed)}", color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
            }
        }
    }
}

private suspend fun recognize(bitmap: Bitmap): String = suspendCancellableCoroutine { cont ->
    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).process(InputImage.fromBitmap(bitmap, 0))
        .addOnSuccessListener { cont.resume(it.text) }
        .addOnFailureListener { cont.resume("") }
}

@Composable
fun UploadScreen(done: () -> Unit) {
    val context = LocalContext.current
    var uri by remember { mutableStateOf<Uri?>(null) }
    var parsed by remember { mutableStateOf<ParsedBill?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val run = rememberRunner()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { picked ->
        if (picked == null) return@rememberLauncherForActivityResult
        uri = picked; parsed = null; error = ""; busy = true
        scope.launch {
            try {
                val bmp = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(picked)!!.use { BitmapFactory.decodeStream(it) } }
                val p = BillParser.parse(recognize(bmp))
                parsed = p
                if (p.items.isEmpty()) error = "We couldn't read any items. Try a clearer, well-lit photo."
            } catch (e: Exception) { error = "Could not read that image" }
            busy = false
        }
    }
    Page("Upload a bill") {
        Button({ picker.launch("image/*") }, Modifier.fillMaxWidth()) { Text(if (uri == null) "Choose bill picture" else "Choose a different picture") }
        uri?.let { AsyncImage(it, "Bill", Modifier.fillMaxWidth().heightIn(max = 240.dp)) }
        if (busy) CircularProgressIndicator()
        parsed?.takeIf { it.items.isNotEmpty() }?.let { p ->
            Text(p.merchant ?: "Detected items", style = MaterialTheme.typography.titleMedium)
            p.items.forEach { i ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(if (i.quantity > 1) "${i.quantity} × ${i.name}" else i.name, Modifier.weight(1f)); Text(money(i.price))
                }
            }
            HorizontalDivider()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Total", fontWeight = FontWeight.Bold); Text(money(p.total), fontWeight = FontWeight.Bold)
            }
            Button({
                busy = true
                run({
                    val bytes = context.contentResolver.openInputStream(uri!!)!!.use { it.readBytes() }
                    val mime = context.contentResolver.getType(uri!!) ?: "image/jpeg"
                    Api.uploadBill(bytes, mime, p)
                    withContext(Dispatchers.Main) { done() }
                }, { error = it; busy = false })
            }, Modifier.fillMaxWidth(), enabled = !busy) { Text("Post bill") }
        }
        if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        TextButton(done) { Text("Cancel") }
    }
}

@Composable
fun DetailScreen(id: Long, canBless: Boolean, back: () -> Unit) {
    var detail by remember { mutableStateOf<BillDetail?>(null) }
    var amount by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    val run = rememberRunner()
    fun load() = run({ val d = Api.bill(id); withContext(Dispatchers.Main) { detail = d } }, { error = it })
    LaunchedEffect(id) { load() }
    Page("Bill details") {
        detail?.let { d ->
            Text(d.summary.merchant, style = MaterialTheme.typography.titleLarge)
            AsyncImage(d.summary.imageUrl, "Bill", Modifier.fillMaxWidth().heightIn(max = 240.dp))
            d.items.forEach { i ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(if (i.quantity > 1) "${i.quantity} × ${i.name}" else i.name, Modifier.weight(1f)); Text(money(i.price))
                }
            }
            HorizontalDivider()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Total", fontWeight = FontWeight.Bold); Text(money(d.summary.total), fontWeight = FontWeight.Bold)
            }
            Text("Blessed so far: ${money(d.summary.blessed)}", color = MaterialTheme.colorScheme.outline)
            if (canBless) {
                Field(amount, { amount = it.filter { c -> c.isDigit() || c == '.' } }, "Blessing amount ($)")
                Field(message, { message = it }, "Message (optional)")
                Button({
                    val a = amount.toDoubleOrNull()
                    if (a == null) error = "Enter an amount"
                    else run({ Api.bless(id, a, message); withContext(Dispatchers.Main) { amount = ""; message = ""; error = "" }; load() }, { error = it })
                }, Modifier.fillMaxWidth()) { Text("Bless this bill") }
            }
        } ?: if (error.isEmpty()) CircularProgressIndicator()
        if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        TextButton(back) { Text("Back") }
    }
}
