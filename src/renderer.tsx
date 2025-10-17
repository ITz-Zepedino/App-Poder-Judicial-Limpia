import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Justicia Clara - Comprende tu causa judicial en lenguaje simple</title>
        <meta name="description" content="Traduce información judicial técnica a lenguaje simple y comprensible. Consulta causas por ROL, nombre, fecha o RUC." />
        <meta name="keywords" content="poder judicial, causas judiciales, chile, consulta causas, traducción legal, lenguaje simple" />
        
        {/* Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        
        {/* Font Awesome */}
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet" />
        
        {/* Custom styles */}
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body>
        {children}
        <script src="/static/app.js"></script>
      </body>
    </html>
  )
})
