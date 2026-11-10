"use strict";

/* DoIt: aplicación local. La autenticación es una demostración, NO un servicio
   seguro de cuentas. Para producción se necesita backend y sesiones reales. */
const KEYS = {
  users: "doit_v2_users",
  session: "doit_v2_session",
  tasks: "doit_v2_tasks",
  categories: "doit_v2_categories",
  notifications: "doit_v2_notifications"
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DEFAULT_CATEGORIES = [
  { name: "Personal", color: "#e23e43" },
  { name: "Estudios", color: "#5b82d5" },
  { name: "Trabajo", color: "#a779db" },
  { name: "Salud", color: "#24a68a" }
];
const PRESET_REMINDERS = new Set([0, 15, 30, 60, 180, 360, 720, 1440, 2880, 4320, 10080, 20160]);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const state = {
  user: null,
  page: "overview",
  taskEditingId: null,
  categoryEditingId: null,
  customReminders: new Set(),
  chosenDate: localDateString(new Date()),
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  weekSelected: localDateString(new Date()),
  toastTimeouts: []
};

function load(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { toast("No fue posible guardar. Revisa el almacenamiento del navegador.", true); }
}
function uid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function own(items) { return items.filter(item => item.userId === state.user?.id); }
function allTasks() { return own(load(KEYS.tasks)); }
function allCategories() { return own(load(KEYS.categories)); }
function allNotifications() { return own(load(KEYS.notifications)); }
function normalizeName(s) { return s.trim().toLocaleLowerCase("es"); }

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dueDate(task) { return new Date(`${task.date}T${task.time}:00`); }
function dateFromInput(date) { return new Date(`${date}T12:00:00`); }
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function sameDay(a, b) { return localDateString(a) === localDateString(b); }
function formatDue(task) {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(dueDate(task));
}
function formatFullDay(str) {
  return new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long" }).format(dateFromInput(str));
}
function isOverdue(task) { return task.status === "pending" && dueDate(task).getTime() < Date.now(); }
function sortedTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return dueDate(a) - dueDate(b);
  });
}
function svg(name, className = "icon") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("class", className);
  node.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  node.append(use);
  return node;
}
function element(tag, cls = "", text = null) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== null) node.textContent = String(text);
  return node;
}
function toast(message, isError = false) {
  const item = element("div", `toast${isError ? " error" : ""}`, message);
  $("#toastStack").append(item);
  setTimeout(() => item.remove(), 4100);
}
function showFormError(id, message) { const p = $(id); p.textContent = message; p.hidden = false; }
function clearFormError(id) { const p = $(id); p.textContent = ""; p.hidden = true; }

// Clave derivada con PBKDF2: evita contraseñas en texto plano en esta demo.
// El login sigue siendo del lado cliente y no es seguro para un despliegue real.
function hex(bytes) { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
function fromHex(value) { return new Uint8Array(value.match(/.{2}/g).map(value => parseInt(value, 16))); }
async function passwordHash(password, saltHex) {
  if (!window.crypto?.subtle) throw new Error("Para iniciar sesión, abre DoIt desde localhost o HTTPS (por ejemplo con Live Server).");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromHex(saltHex), iterations: 160000, hash: "SHA-256" }, material, 256);
  return hex(new Uint8Array(bits));
}
function newSalt() { return hex(crypto.getRandomValues(new Uint8Array(16))); }
function switchAuth(mode) {
  const login = mode === "login";
  $("#loginTab").classList.toggle("active", login);
  $("#registerTab").classList.toggle("active", !login);
  $("#loginTab").setAttribute("aria-selected", String(login));
  $("#registerTab").setAttribute("aria-selected", String(!login));
  $("#loginForm").hidden = !login;
  $("#registerForm").hidden = login;
  $("#authHeading").textContent = login ? "¡Qué bueno verte!" : "Crea tu espacio";
  $("#authSubtitle").textContent = login ? "Inicia sesión para continuar donde lo dejaste." : "Un pequeño plan puede cambiar tu día.";
  clearFormError("#loginError");
  clearFormError("#registerError");
}
function seedCategories(userId) {
  const data = load(KEYS.categories);
  if (data.some(c => c.userId === userId)) return;
  DEFAULT_CATEGORIES.forEach(({ name, color }) => data.push({ id: uid(), userId, name, color }));
  store(KEYS.categories, data);
}
function signIn(user) {
  state.user = user;
  store(KEYS.session, { userId: user.id });
  seedCategories(user.id);
  $("#authScreen").hidden = true;
  $("#appScreen").hidden = false;
  $("#sidebarName").textContent = user.name;
  $("#sidebarEmail").textContent = user.email;
  $("#sidebarAvatar").textContent = user.name.charAt(0).toUpperCase();
  $("#greetingName").textContent = user.name.split(" ")[0];
  state.page = "overview";
  navigate("overview");
  checkReminders();
}
function logout() {
  localStorage.removeItem(KEYS.session);
  state.user = null;
  $("#appScreen").hidden = true;
  $("#authScreen").hidden = false;
  $("#notificationPopover").hidden = true;
  $("#loginForm").reset();
  switchAuth("login");
  toast("Sesión cerrada.");
}
$("#loginTab").addEventListener("click", () => switchAuth("login"));
$("#registerTab").addEventListener("click", () => switchAuth("register"));
$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormError("#registerError");
  const name = $("#registerName").value.trim();
  const email = $("#registerEmail").value.trim().toLowerCase();
  const password = $("#registerPassword").value;
  if (!name || !$("#registerEmail").checkValidity() || password.length < 8) {
    showFormError("#registerError", "Ingresa tu nombre, un correo válido y una contraseña de al menos 8 caracteres."); return;
  }
  const users = load(KEYS.users);
  if (users.some(user => user.email === email)) { showFormError("#registerError", "Ese correo ya tiene una cuenta."); return; }
  const btn = $("#registerForm button[type=submit]");
  btn.disabled = true;
  try {
    const salt = newSalt();
    const user = { id: uid(), name, email, salt, hash: await passwordHash(password, salt) };
    users.push(user);
    store(KEYS.users, users);
    $("#registerForm").reset();
    signIn(user);
    toast("¡Tu cuenta está lista! Bienvenido a DoIt.");
  } catch (error) { showFormError("#registerError", error.message || "No se pudo crear la cuenta."); }
  finally { btn.disabled = false; }
});
$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormError("#loginError");
  const email = $("#loginEmail").value.trim().toLowerCase();
  const password = $("#loginPassword").value;
  const user = load(KEYS.users).find(user => user.email === email);
  if (!user || !password) { showFormError("#loginError", "Correo o contraseña incorrectos."); return; }
  const btn = $("#loginForm button[type=submit]");
  btn.disabled = true;
  try {
    const derived = await passwordHash(password, user.salt);
    if (derived !== user.hash) { showFormError("#loginError", "Correo o contraseña incorrectos."); return; }
    signIn(user);
    $("#loginForm").reset();
  } catch (error) { showFormError("#loginError", error.message || "No se pudo iniciar sesión."); }
  finally { btn.disabled = false; }
});
$("#logoutBtn").addEventListener("click", logout);

const PAGE_INFO = {
  overview: ["TU PANEL PERSONAL", "Resumen", "Un vistazo a todo lo que estás logrando."],
  tasks: ["TU LISTA AL DÍA", "Mis tareas", "Cada pequeño paso cuenta."],
  calendar: ["PLANIFICA TU TIEMPO", "Calendario", "Elige un día para ver tus entregas."],
  categories: ["ORGANIZA A TU MANERA", "Categorías", "Cada tarea tiene su lugar."]
};
function navigate(page) {
  if (!PAGE_INFO[page]) return;
  state.page = page;
  $$("[data-page]").forEach(node => node.classList.toggle("active", node.dataset.page === page));
  $$("[data-view]").forEach(node => node.classList.toggle("active", node.dataset.view === page));
  const [eyebrow, title, subtitle] = PAGE_INFO[page];
  $("#topEyebrow").textContent = eyebrow;
  $("#topTitle").textContent = title;
  $("#topSubtitle").textContent = subtitle;
  renderAll();
  window.scrollTo({ top: 0, behavior: "instant" });
}
$$("[data-view]").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.view)));
$$("[data-go]").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.go)));

// Task creation / editing.
function defaultDeadline() {
  const d = addDays(new Date(), 1);
  d.setHours(18, 0, 0, 0);
  return { date: localDateString(d), time: "18:00" };
}
function updateCategorySelect() {
  const select = $("#taskCategory");
  const old = select.value;
  select.replaceChildren();
  const cats = allCategories();
  cats.forEach(category => { const option = element("option", "", category.name); option.value = category.id; select.append(option); });
  if (cats.some(c => c.id === old)) select.value = old;
  else if (cats.length) select.value = cats[0].id;
}
function offsetLabel(minutes) {
  if (minutes === 0) return "Al vencer";
  const units = [
    [10080, "semana", "semanas"],
    [1440, "día", "días"],
    [60, "hora", "horas"],
    [1, "minuto", "minutos"]
  ];
  for (const [unit, singular, plural] of units) {
    if (minutes % unit === 0) {
      const n = minutes / unit;
      return `${n} ${n === 1 ? singular : plural} antes`;
    }
  }
  return `${minutes} minutos antes`;
}
function collectReminders() {
  const presets = $$("#reminderPresets input:checked").map(input => Number(input.value));
  return [...new Set([...presets, ...state.customReminders])].sort((a, b) => b - a);
}
function renderCustomReminders() {
  const wrap = $("#customReminderList");
  wrap.replaceChildren();
  [...state.customReminders].sort((a,b) => b-a).forEach(minutes => {
    const chip = element("button", "removable-chip", `${offsetLabel(minutes)}  ×`);
    chip.type = "button";
    chip.setAttribute("aria-label", `Eliminar recordatorio ${offsetLabel(minutes)}`);
    chip.addEventListener("click", () => { state.customReminders.delete(minutes); renderCustomReminders(); });
    wrap.append(chip);
  });
}
function setReminders(values) {
  const reminders = new Set(values || []);
  $$("#reminderPresets input").forEach(input => input.checked = reminders.has(Number(input.value)));
  state.customReminders = new Set([...reminders].filter(value => !PRESET_REMINDERS.has(value)));
  renderCustomReminders();
}
function openTaskModal(taskId = null) {
  state.taskEditingId = taskId;
  $("#taskForm").reset();
  clearFormError("#taskFormError");
  updateCategorySelect();
  const task = allTasks().find(t => t.id === taskId);
  $("#taskDialogTitle").textContent = task ? "Editar tarea" : "Nueva tarea";
  $("#saveTaskBtn").textContent = task ? "Guardar cambios" : "Crear tarea";
  if (task) {
    $("#taskTitle").value = task.title;
    $("#taskDescription").value = task.description || "";
    $("#taskCategory").value = task.categoryId;
    $("#taskPriority").value = task.priority || "medium";
    $("#taskDate").value = task.date;
    $("#taskTime").value = task.time;
    setReminders(task.reminders);
  } else {
    const due = defaultDeadline();
    $("#taskDate").value = due.date;
    $("#taskTime").value = due.time;
    setReminders([60]);
  }
  $("#taskDialog").showModal();
  setTimeout(() => $("#taskTitle").focus(), 20);
}
$("#newTaskTopBtn").addEventListener("click", () => openTaskModal());
$("#mobileNewTaskBtn").addEventListener("click", () => openTaskModal());
$("#addCustomReminderBtn").addEventListener("click", () => {
  const amount = Number($("#customReminderAmount").value);
  const unit = Number($("#customReminderUnit").value);
  if (!Number.isInteger(amount) || amount < 1 || amount > 365) { toast("Elige un número entre 1 y 365.", true); return; }
  const minutes = amount * unit;
  if (minutes > 525600) { toast("El máximo es un año de anticipación.", true); return; }
  if (PRESET_REMINDERS.has(minutes)) {
    $(`#reminderPresets input[value="${minutes}"]`).checked = true;
    toast("Recordatorio añadido a la selección."); return;
  }
  state.customReminders.add(minutes);
  renderCustomReminders();
});
$("#taskForm").addEventListener("submit", event => {
  event.preventDefault();
  clearFormError("#taskFormError");
  const title = $("#taskTitle").value.trim();
  const description = $("#taskDescription").value.trim();
  const categoryId = $("#taskCategory").value;
  const priority = $("#taskPriority").value;
  const date = $("#taskDate").value;
  const time = $("#taskTime").value;
  const reminders = collectReminders();
  if (!title) { showFormError("#taskFormError", "Escribe un nombre para tu tarea."); return; }
  if (!allCategories().some(c => c.id === categoryId)) { showFormError("#taskFormError", "Selecciona una categoría válida."); return; }
  if (!date || !time || !Number.isFinite(new Date(`${date}T${time}:00`).getTime())) {
    showFormError("#taskFormError", "La fecha y la hora límite son obligatorias."); return;
  }
  const tasks = load(KEYS.tasks);
  const existing = tasks.find(task => task.id === state.taskEditingId && task.userId === state.user.id);
  const now = new Date().toISOString();
  const updated = {
    id: existing?.id || uid(), userId: state.user.id,
    title, description, categoryId, priority, date, time, reminders,
    status: existing?.status || "pending",
    createdAt: existing?.createdAt || now,
    reminderActivatedAt: now, reminderVersion: uid()
  };
  if (existing) Object.assign(existing, updated);
  else tasks.push(updated);
  store(KEYS.tasks, tasks);
  $("#taskDialog").close();
  renderAll();
  checkReminders();
  toast(existing ? "Tarea actualizada." : "¡Nueva tarea creada!");
});
function toggleTask(taskId) {
  const tasks = load(KEYS.tasks);
  const task = tasks.find(t => t.id === taskId && t.userId === state.user?.id);
  if (!task) return;
  task.status = task.status === "done" ? "pending" : "done";
  store(KEYS.tasks, tasks);
  renderAll();
  toast(task.status === "done" ? "¡Una tarea menos! Bien hecho." : "Tarea marcada como pendiente.");
}
function deleteTask(taskId) {
  const task = allTasks().find(t => t.id === taskId);
  if (!task || !confirm(`¿Eliminar la tarea «${task.title}»?`)) return;
  store(KEYS.tasks, load(KEYS.tasks).filter(t => t.id !== taskId));
  store(KEYS.notifications, load(KEYS.notifications).filter(n => n.taskId !== taskId));
  renderAll();
  toast("Tarea eliminada.");
}
function renderTaskRow(task) {
  const cat = allCategories().find(c => c.id === task.categoryId);
  const row = element("article", `task-row${task.status === "done" ? " is-done" : ""}`);
  const check = element("button", `task-check ${task.status === "done" ? "done" : ""}`);
  check.type = "button";
  check.setAttribute("aria-label", task.status === "done" ? `Marcar ${task.title} como pendiente` : `Completar ${task.title}`);
  if (task.status === "done") check.append(svg("check"));
  check.addEventListener("click", () => toggleTask(task.id));
  row.append(check);
  const main = element("div", "task-main");
  main.append(element("h4", "task-name", task.title));
  if (task.description) main.append(element("p", "task-description", task.description));
  const meta = element("div", "task-meta");
  const category = element("span", "category-badge");
  const dot = element("span", "color-dot");
  dot.style.setProperty("--dot", cat?.color || "#aaa");
  category.append(dot, document.createTextNode(cat?.name || "Sin categoría"));
  meta.append(category);
  const due = element("span", `due-badge${isOverdue(task) ? " overdue" : ""}`);
  due.append(svg("clock"), document.createTextNode(isOverdue(task) ? `Vencida · ${formatDue(task)}` : formatDue(task)));
  meta.append(due);
  const priority = element("span", `priority-badge priority-${task.priority || "medium"}`, { high: "Alta", medium: "Media", low: "Baja" }[task.priority] || "Media");
  meta.append(priority);
  if (task.reminders?.length) {
    const badge = element("span", "due-badge", `🔔 ${task.reminders.length} aviso${task.reminders.length === 1 ? "" : "s"}`);
    meta.append(badge);
  }
  main.append(meta);
  row.append(main);
  const actions = element("div", "task-actions");
  const edit = element("button", "small-icon-btn");
  edit.type = "button"; edit.title = "Editar tarea"; edit.setAttribute("aria-label", `Editar ${task.title}`); edit.append(svg("edit"));
  edit.addEventListener("click", () => openTaskModal(task.id));
  const del = element("button", "small-icon-btn");
  del.type = "button"; del.title = "Eliminar tarea"; del.setAttribute("aria-label", `Eliminar ${task.title}`); del.append(svg("trash"));
  del.addEventListener("click", () => deleteTask(task.id));
  actions.append(edit, del); row.append(actions);
  return row;
}
function renderTaskList(target, tasks, emptyText = "No hay tareas por aquí todavía.") {
  const container = $(target);
  container.replaceChildren();
  if (!tasks.length) {
    const empty = element("div", "empty-state");
    empty.append(element("span", "empty-symbol", "✦"), element("strong", "", "¡Todo en orden!"), element("p", "", emptyText));
    container.append(empty); return;
  }
  tasks.forEach(task => container.append(renderTaskRow(task)));
}

// Categories persist for every account until edited or deleted.
function openCategoryModal(categoryId = null) {
  state.categoryEditingId = categoryId;
  $("#categoryForm").reset();
  clearFormError("#categoryFormError");
  const cat = allCategories().find(c => c.id === categoryId);
  $("#categoryDialogTitle").textContent = cat ? "Editar categoría" : "Nueva categoría";
  $("#categoryName").value = cat?.name || "";
  $("#categoryColor").value = cat?.color || "#e23e43";
  $("#categoryDialog").showModal();
  setTimeout(() => $("#categoryName").focus(), 20);
}
$("#newCategoryBtn").addEventListener("click", () => openCategoryModal());
$("#newCategoryPreviewBtn").addEventListener("click", () => openCategoryModal());
$$(".swatch").forEach(btn => btn.addEventListener("click", () => $("#categoryColor").value = btn.dataset.color));
$("#categoryForm").addEventListener("submit", event => {
  event.preventDefault();
  clearFormError("#categoryFormError");
  const name = $("#categoryName").value.trim();
  const color = $("#categoryColor").value;
  if (!name) { showFormError("#categoryFormError", "La categoría necesita un nombre."); return; }
  if (allCategories().some(c => normalizeName(c.name) === normalizeName(name) && c.id !== state.categoryEditingId)) {
    showFormError("#categoryFormError", "Ya tienes una categoría con ese nombre."); return;
  }
  const data = load(KEYS.categories);
  const existing = data.find(c => c.id === state.categoryEditingId && c.userId === state.user.id);
  if (existing) { existing.name = name; existing.color = color; }
  else data.push({ id: uid(), userId: state.user.id, name, color });
  store(KEYS.categories, data);
  $("#categoryDialog").close(); renderAll();
  toast(existing ? "Categoría actualizada." : "Categoría creada.");
});
function deleteCategory(id) {
  const category = allCategories().find(c => c.id === id);
  if (!category) return;
  if (allCategories().length <= 1) { toast("Debes conservar al menos una categoría.", true); return; }
  const numTasks = allTasks().filter(t => t.categoryId === id).length;
  if (numTasks) { toast(`Esta categoría tiene ${numTasks} tarea(s). Cámbialas de categoría antes de eliminarla.`, true); return; }
  if (!confirm(`¿Eliminar la categoría «${category.name}»?`)) return;
  store(KEYS.categories, load(KEYS.categories).filter(c => c.id !== id));
  renderAll(); toast("Categoría eliminada.");
}
function renderCategories() {
  const categories = allCategories();
  const tasks = allTasks();
  const wrapper = $("#categoriesGrid"); wrapper.replaceChildren();
  categories.forEach(cat => {
    const items = tasks.filter(t => t.categoryId === cat.id);
    const done = items.filter(t => t.status === "done").length;
    const card = element("article", "category-card");
    card.style.setProperty("--cat-color", cat.color);
    card.style.setProperty("--cat-bg", `${cat.color}17`);
    const head = element("div", "category-card-head");
    const symbol = element("div", "category-symbol"); symbol.append(svg("tag"));
    const menu = element("div", "category-card-menu");
    const edit = element("button", "small-icon-btn"); edit.type = "button"; edit.setAttribute("aria-label", `Editar ${cat.name}`); edit.append(svg("edit")); edit.addEventListener("click", () => openCategoryModal(cat.id));
    const del = element("button", "small-icon-btn"); del.type = "button"; del.setAttribute("aria-label", `Eliminar ${cat.name}`); del.append(svg("trash")); del.addEventListener("click", () => deleteCategory(cat.id));
    menu.append(edit, del); head.append(symbol, menu);
    card.append(head, element("h3", "", cat.name), element("p", "", `${items.length} tarea${items.length === 1 ? "" : "s"} · ${done} completada${done === 1 ? "" : "s"}`));
    const progress = element("div", "category-card-progress"); const bar = element("span"); bar.style.width = `${items.length ? done / items.length * 100 : 0}%`; progress.append(bar); card.append(progress);
    wrapper.append(card);
  });
  const preview = $("#categoryPreviewList"); preview.replaceChildren();
  categories.slice(0, 6).forEach(cat => {
    const item = element("div", "category-preview-item");
    const dot = element("span", "color-dot"); dot.style.setProperty("--dot", cat.color);
    item.append(dot, element("span", "", cat.name), element("span", "count", tasks.filter(t => t.categoryId === cat.id && t.status === "pending").length));
    preview.append(item);
  });
  const filter = $("#categoryFilter");
  const selected = filter.value;
  filter.replaceChildren();
  const option = element("option", "", "Todas las categorías"); option.value = "all"; filter.append(option);
  categories.forEach(cat => { const option = element("option", "", cat.name); option.value = cat.id; filter.append(option); });
  filter.value = categories.some(c => c.id === selected) ? selected : "all";
}

function renderOverview() {
  const tasks = allTasks();
  const completed = tasks.filter(t => t.status === "done").length;
  const pending = tasks.filter(t => t.status === "pending").length;
  const overdue = tasks.filter(isOverdue).length;
  $("#heroTotal").textContent = tasks.length;
  $("#heroDone").textContent = completed;
  $("#heroProgress").style.width = `${tasks.length ? 100 * completed / tasks.length : 0}%`;
  $("#heroProgressText").textContent = tasks.length ? `${Math.round(100 * completed / tasks.length)}% de tus tareas terminadas. ¡Sigue así!` : "Tu próximo logro está a un clic de distancia.";
  $("#pendingStat").textContent = pending;
  $("#doneStat").textContent = completed;
  $("#overdueStat").textContent = overdue;
  $("#todayLabel").textContent = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  renderTaskList("#overviewTaskList", sortedTasks(tasks.filter(t => t.status === "pending")).slice(0, 5), "No tienes pendientes. Crea una nueva tarea cuando quieras.");
  renderWeekStrip();
  renderAgenda();
}
function renderWeekStrip() {
  const today = new Date();
  const start = addDays(today, -((today.getDay() + 6) % 7));
  const names = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];
  const wrap = $("#weekStrip"); wrap.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i), stringDate = localDateString(date);
    const hasTasks = allTasks().some(t => t.date === stringDate && t.status === "pending");
    const btn = element("button", `week-day${stringDate === state.weekSelected ? " selected" : ""}${hasTasks ? " has-task" : ""}`);
    btn.type = "button";
    btn.setAttribute("aria-label", formatFullDay(stringDate));
    btn.append(element("strong", "", names[i]), element("span", "", date.getDate()));
    btn.addEventListener("click", () => { state.weekSelected = stringDate; renderWeekStrip(); renderAgenda(); });
    wrap.append(btn);
  }
}
function renderAgenda() {
  const today = localDateString(new Date());
  const showUpcoming = state.weekSelected === today;
  $(".agenda-subhead").textContent = showUpcoming ? "Próximos vencimientos" : `Vencen el ${new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(dateFromInput(state.weekSelected))}`;
  const tasks = allTasks().filter(t => t.status === "pending");
  const selected = showUpcoming ? tasks.filter(t => t.date >= today) : tasks.filter(t => t.date === state.weekSelected);
  const upcoming = sortedTasks(selected).slice(0, 5);
  const wrap = $("#agendaList"); wrap.replaceChildren();
  if (!upcoming.length) { wrap.append(element("p", "agenda-empty", "No hay vencimientos para mostrar. ¡Un respiro merecido!")); return; }
  upcoming.forEach(task => {
    const date = dueDate(task);
    const item = element("div", "agenda-item");
    const d = element("div", "agenda-date");
    d.append(element("strong", "", date.getDate()), element("span", "", new Intl.DateTimeFormat("es-CO", { month: "short" }).format(date).replace(".", "").toUpperCase()));
    const details = element("div", "agenda-details");
    details.append(element("strong", "", task.title), element("span", "", new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true }).format(date)));
    item.append(d, details); wrap.append(item);
  });
}
function renderTasksPage() {
  const tasks = allTasks();
  const query = normalizeName($("#taskSearch").value);
  const status = $("#statusFilter").value;
  const category = $("#categoryFilter").value;
  const results = sortedTasks(tasks).filter(task => {
    if (query && !normalizeName(`${task.title} ${task.description || ""}`).includes(query)) return false;
    if (category !== "all" && task.categoryId !== category) return false;
    if (status === "overdue") return isOverdue(task);
    if (status !== "all" && task.status !== status) return false;
    return true;
  });
  $("#taskPageCount").textContent = `${results.length} tarea${results.length === 1 ? "" : "s"}`;
  renderTaskList("#allTasksList", results, "Prueba otro filtro o crea tu primera tarea.");
}
$("#taskSearch").addEventListener("input", renderTasksPage);
$("#statusFilter").addEventListener("change", renderTasksPage);
$("#categoryFilter").addEventListener("change", renderTasksPage);

function renderCalendar() {
  const month = state.calendarMonth;
  $("#calendarMonthLabel").textContent = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" }).format(month);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const tasks = allTasks();
  const wrap = $("#calendarGrid"); wrap.replaceChildren();
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    const iso = localDateString(day);
    const dayTasks = tasks.filter(t => t.date === iso);
    const classes = ["calendar-day"];
    if (day.getMonth() !== month.getMonth()) classes.push("outside");
    if (sameDay(day, new Date())) classes.push("today");
    if (iso === state.chosenDate) classes.push("selected");
    const btn = element("button", classes.join(" "));
    btn.type = "button"; btn.setAttribute("aria-label", formatFullDay(iso));
    btn.append(element("span", "", day.getDate()));
    const dots = element("div", "calendar-dots");
    dayTasks.slice(0, 3).forEach(() => dots.append(element("i")));
    btn.append(dots);
    btn.addEventListener("click", () => { state.chosenDate = iso; if (day.getMonth() !== month.getMonth()) state.calendarMonth = new Date(day.getFullYear(), day.getMonth(), 1); renderCalendar(); });
    wrap.append(btn);
  }
  $("#selectedDayLabel").textContent = formatFullDay(state.chosenDate);
  renderTaskList("#dayTaskList", sortedTasks(tasks.filter(t => t.date === state.chosenDate)), "No hay tareas para esta fecha.");
}
$("#prevMonthBtn").addEventListener("click", () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1); renderCalendar(); });
$("#nextMonthBtn").addEventListener("click", () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1); renderCalendar(); });
$("#calendarTodayBtn").addEventListener("click", () => { state.chosenDate = localDateString(new Date()); state.calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCalendar(); });

// In-app notifications + optional Notification API while this page is open.
function checkReminders() {
  if (!state.user) return;
  const now = Date.now();
  const notifications = load(KEYS.notifications);
  const known = new Set(notifications.filter(n => n.userId === state.user.id).map(n => n.id));
  let added = 0;
  allTasks().filter(t => t.status === "pending").forEach(task => {
    const due = dueDate(task).getTime();
    const activated = new Date(task.reminderActivatedAt || task.createdAt).getTime();
    (task.reminders || []).forEach(minutes => {
      const time = due - minutes * 60_000;
      // No disparamos recordatorios configurados cuando su hora ya había pasado.
      if (time < activated - 1_000 || now < time || now - time > DAY) return;
      const id = `${task.id}:${task.reminderVersion || task.id}:${minutes}`;
      if (known.has(id)) return;
      const message = minutes === 0
        ? `«${task.title}» llegó a su fecha y hora límite.`
        : `«${task.title}» vence en ${offsetLabel(minutes).replace(" antes", "")}.`;
      const notification = { id, taskId: task.id, userId: state.user.id, title: "Tienes una tarea pendiente", message, read: false, createdAt: new Date().toISOString() };
      notifications.push(notification); known.add(id); added++;
      if ("Notification" in window && Notification.permission === "granted") {
        try { new Notification("DoIt · Recordatorio", { body: message, tag: id }); } catch { /* navegador no compatible */ }
      }
    });
  });
  if (added) {
    store(KEYS.notifications, notifications);
    toast(added === 1 ? "Tienes un nuevo recordatorio 🔔" : `Tienes ${added} recordatorios nuevos 🔔`);
  }
  renderNotifications();
}
function renderNotifications() {
  if (!state.user) return;
  const notifications = allNotifications().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const unread = notifications.filter(n => !n.read).length;
  $("#notificationDot").hidden = unread === 0;
  const list = $("#notificationList"); list.replaceChildren();
  if (!notifications.length) {
    list.append(element("p", "agenda-empty", "Aún no hay avisos. Aquí aparecerán cuando llegue la hora de un recordatorio."));
  } else notifications.slice(0, 25).forEach(n => {
    const item = element("div", `notification-item${n.read ? "" : " unread"}`);
    item.append(svg("bell"));
    const text = element("div");
    text.append(element("strong", "", n.title), element("p", "", n.message), element("time", "", new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(n.createdAt))));
    item.append(text); list.append(item);
  });
  const button = $("#enableNotificationsBtn");
  button.hidden = !("Notification" in window) || Notification.permission === "granted" || Notification.permission === "denied";
}
$("#bellBtn").addEventListener("click", event => {
  event.stopPropagation();
  const popover = $("#notificationPopover");
  popover.hidden = !popover.hidden;
  $("#bellBtn").setAttribute("aria-expanded", String(!popover.hidden));
  renderNotifications();
});
$("#notificationPopover").addEventListener("click", event => event.stopPropagation());
document.addEventListener("click", () => {
  $("#notificationPopover").hidden = true;
  $("#bellBtn").setAttribute("aria-expanded", "false");
});
$("#markReadBtn").addEventListener("click", () => {
  const data = load(KEYS.notifications);
  data.forEach(n => { if (n.userId === state.user.id) n.read = true; });
  store(KEYS.notifications, data); renderNotifications();
});
$("#enableNotificationsBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) { toast("Tu navegador no admite notificaciones.", true); return; }
  try {
    const permission = await Notification.requestPermission();
    toast(permission === "granted" ? "Notificaciones del navegador activadas." : "Puedes seguir usando los avisos dentro de DoIt.");
  } catch { toast("No se pudieron activar. Prueba en HTTPS o localhost.", true); }
  renderNotifications();
});

$$("[data-close-dialog]").forEach(btn => btn.addEventListener("click", () => $("#" + btn.dataset.closeDialog).close()));
$$("dialog").forEach(dialog => dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); }));
function renderAll() {
  if (!state.user) return;
  renderCategories();
  renderOverview();
  renderTasksPage();
  renderCalendar();
  renderNotifications();
}
function initialize() {
  const session = load(KEYS.session, null);
  const user = session?.userId ? load(KEYS.users).find(u => u.id === session.userId) : null;
  if (user) signIn(user);
  else { $("#authScreen").hidden = false; $("#appScreen").hidden = true; }
}
initialize();
setInterval(checkReminders, 30_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkReminders(); if (state.user) renderAll(); } });
