# 💖 Hub Interactivo de Parejas (Nuestro Rincón)

Una aplicación web privada diseñada exclusivamente para dos personas. Permite conectar a la pareja mediante un código de invitación único de 6 caracteres, visualizar un contador de tiempo juntos en tiempo real y compartir un muro interactivo de notas y recuerdos especiales.

---

## 🌟 Características Principales

* **Aislamiento Estricto para 2 Personas:** Límite infranqueable a nivel de base de datos (PostgreSQL con bloqueo de fila `FOR UPDATE`).
* **Autenticación Simple (Sin Correo):** Registro e inicio de sesión únicamente con nombre de usuario y contraseña.
* **Onboarding por Código de 6 Caracteres:** El Usuario 1 genera un código único de invitación (Base32) y la app espera en tiempo real a que el Usuario 2 lo canjee.
* **Contador en Tiempo Real:** Visualización dinámica de años, meses, días, horas, minutos y segundos transcurridos desde el inicio de la relación.
* **Muro de Notas de Amor:** Tarjetas estilo post-it con selección de colores, opción de fijado (`pinned`) y sincronización instantánea vía WebSockets (Supabase Realtime).
* **Línea de Recuerdos:** Registro cronológico de momentos memorables compartidos.
* **100% Vanilla:** Construido con HTML5 semántico, CSS3 moderno y JavaScript ES6+ modular (cero dependencias pesadas).

---

## 🛠️ Stack Tecnológico

* **Frontend:** HTML5, CSS3, JavaScript Vanilla (ES Modules vía CDN).
* **Backend y Base de Datos:** [Supabase](https://supabase.com) (PostgreSQL 15+, Supabase Auth, Row Level Security y Supabase Realtime).

---

## 🚀 Despliegue y Configuración Rápida

### 1. Configurar Supabase
1. Crea un proyecto en [Supabase](https://supabase.com).
2. Ve al **SQL Editor** de tu proyecto y ejecuta el archivo [`schema.sql`](schema.sql).
3. En **Project Settings > API**, copia tu **Project URL** y tu **anon public key**.
4. *(Recomendado)* En **Authentication > Providers > Email**, desmarca la casilla **"Confirm email"** para permitir el registro inmediato.

### 2. Configurar la App
Edita el archivo `supabaseClient.js`:
```javascript
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'TU-ANON-KEY-AQUI';
```

### 3. Ejecutar Localmente
Al usar módulos ES6, abre el proyecto con un servidor local:

```bash
# Con Python
python -m http.server 8000

# O con Node.js
npx serve
```
Abre tu navegador en `http://localhost:8000`.

---

## 🌐 Publicar en GitHub Pages

Este proyecto no requiere compilación (`build`). Puedes publicarlo directamente en **GitHub Pages**:
1. Sube este repositorio a GitHub.
2. Ve a **Settings > Pages**.
3. En **Branch**, selecciona `main` (o `master`) y la carpeta `/ (root)`.
4. Haz clic en **Save**. ¡Tu app estará viva en la web para ti y tu pareja en segundos!

---

## 📄 Licencia
Distribuido bajo la Licencia MIT.
