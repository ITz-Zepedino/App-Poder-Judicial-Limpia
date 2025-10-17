// ====================================
// JUSTICIA CLARA - BÚSQUEDA POR NOMBRE
// ====================================

document.addEventListener('DOMContentLoaded', function() {
  // Elementos del DOM
  const tipoPersonaRadios = document.querySelectorAll('input[name="tipo-persona"]');
  const camposPersonaNatural = document.getElementById('campos-persona-natural');
  const camposPersonaJuridica = document.getElementById('campos-persona-juridica');
  const competenciaSelect = document.getElementById('competencia-select');
  const camposDependientes = document.getElementById('campos-dependientes');
  const tribunalSelect = document.getElementById('tribunal-select');
  const corteSelect = document.getElementById('corte-select');
  const form = document.getElementById('form-busqueda-nombre');
  
  // Datos de tribunales y cortes según documento del usuario
  const cortesApelaciones = [
    'C.A. de Arica', 'C.A. de Iquique', 'C.A. de Antofagasta', 'C.A. de Copiapó',
    'C.A. de La Serena', 'C.A. de Valparaíso', 'C.A. de Rancagua', 'C.A. de Talca',
    'C.A. de Chillán', 'C.A. de Concepción', 'C.A. de Temuco', 'C.A. de Valdivia',
    'C.A. de Puerto Montt', 'C.A. de Coyhaique', 'C.A. de Punta Arenas',
    'C.A. de Santiago', 'C.A. de San Miguel'
  ];
  
  const tribunalesPorCompetencia = {
    'Civil': [
      '1º Juzgado Civil de Santiago', '2º Juzgado Civil de Santiago', '3º Juzgado Civil de Santiago',
      '4º Juzgado Civil de Santiago', '5º Juzgado Civil de Santiago', '6º Juzgado Civil de Santiago',
      '1º Juzgado de Letras de Arica', '2º Juzgado de Letras de Arica', '3º Juzgado de Letras de Arica',
      '1º Juzgado Civil de Valparaíso', '2º Juzgado Civil de Valparaíso', '3º Juzgado Civil de Valparaíso'
    ],
    'Laboral': [
      'Juzgado de Letras del Trabajo de Arica', 'Juzgado de Letras del Trabajo de Iquique',
      'Juzgado de Letras del Trabajo de Antofagasta', 'Juzgado de Letras del Trabajo de Copiapó',
      'Juzgado de Letras del Trabajo de La Serena', 'Juzgado de Letras del Trabajo de Valparaíso',
      'Juzgado de Letras del Trabajo de Rancagua', '1º Juzgado de Letras del Trabajo de Santiago',
      '2º Juzgado de Letras del Trabajo de Santiago', 'Juzgado de Letras del Trabajo de San Miguel'
    ],
    'Cobranza': [
      'Jdo. de Letras y Garantía de Pozo Almonte', 'Juzgado de Letras de Tocopilla',
      'Juzgado de Letras y Garantía de Maria Elena', '1º Juzgado de Letras de Vallenar',
      '2º Juzgado de Letras de Vallenar', '1º Juzgado de Letras de Ovalle'
    ],
    'Penal': [
      'Juzgado De Letras Y Garantía De Pozo Almonte', 'Juzgado De Letras Y Garantía De María Elena',
      'Juzgado De Letras Y Garantía De Taltal', 'Juzgado De Letras Y Garantía De Chañaral',
      'Tribunal De Juicio Oral En Lo Penal De Arica', 'Tribunal De Juicio Oral En Lo Penal De Iquique'
    ]
  };
  
  // Manejar cambio de tipo de persona
  if (tipoPersonaRadios.length > 0) {
    tipoPersonaRadios.forEach(radio => {
      radio.addEventListener('change', function() {
        if (this.value === 'natural') {
          if (camposPersonaNatural) camposPersonaNatural.style.display = 'block';
          if (camposPersonaJuridica) camposPersonaJuridica.style.display = 'none';
        } else {
          if (camposPersonaNatural) camposPersonaNatural.style.display = 'none';
          if (camposPersonaJuridica) camposPersonaJuridica.style.display = 'block';
        }
      });
    });
  }
  
  // Manejar cambio de competencia
  if (competenciaSelect) {
    competenciaSelect.addEventListener('change', function() {
      const competencia = this.value;
      
      if (competencia === 'Corte Suprema') {
        // Corte Suprema no requiere tribunal ni corte
        if (camposDependientes) camposDependientes.style.display = 'none';
        if (tribunalSelect) tribunalSelect.disabled = true;
        if (corteSelect) corteSelect.disabled = true;
      } else if (competencia) {
        if (camposDependientes) camposDependientes.style.display = 'block';
        
        // Habilitar y cargar tribunales
        if (tribunalSelect) {
          tribunalSelect.disabled = false;
          tribunalSelect.innerHTML = '<option value="">Seleccione Tribunal</option>';
          
          if (tribunalesPorCompetencia[competencia]) {
            tribunalesPorCompetencia[competencia].forEach(tribunal => {
              const option = document.createElement('option');
              option.value = tribunal;
              option.textContent = tribunal;
              tribunalSelect.appendChild(option);
            });
          }
        }
        
        // Cargar cortes de apelaciones
        if (corteSelect) {
          corteSelect.disabled = false;
          corteSelect.innerHTML = '<option value="">Seleccione Corte</option>';
          cortesApelaciones.forEach(corte => {
            const option = document.createElement('option');
            option.value = corte;
            option.textContent = corte;
            corteSelect.appendChild(option);
          });
        }
      } else {
        if (camposDependientes) camposDependientes.style.display = 'none';
        if (tribunalSelect) tribunalSelect.disabled = true;
        if (corteSelect) corteSelect.disabled = true;
      }
    });
  }
  
  // Manejar envío del formulario
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      // Mostrar loading
      showLoading();
      hideMessages();
      
      try {
        // Recopilar datos del formulario
        const formData = new FormData(this);
        const tipoPersona = formData.get('tipo-persona');
        
        const requestData = {
          tipoPersona: tipoPersona,
          año: formData.get('año'),
          competencia: formData.get('competencia'),
          tribunal: formData.get('tribunal'),
          corte: formData.get('corte')
        };
        
        if (tipoPersona === 'natural') {
          requestData.nombres = formData.get('nombres');
          requestData.apellidoPaterno = formData.get('apellido-paterno');
          requestData.apellidoMaterno = formData.get('apellido-materno');
        } else {
          requestData.nombrePersonaJuridica = formData.get('nombre-persona-juridica');
        }
        
        // Realizar petición
        const response = await fetch('/api/buscar-nombre', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        
        if (result.success) {
          showResults(result);
        } else {
          showError(result.error || 'Error desconocido');
        }
        
      } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión. Verifique su conexión a internet.');
      } finally {
        hideLoading();
      }
    });
  }
});

function showLoading() {
  const loading = document.getElementById('loading');
  if (loading) loading.classList.remove('hidden');
}

function hideLoading() {
  const loading = document.getElementById('loading');
  if (loading) loading.classList.add('hidden');
}

function showError(message) {
  const errorDiv = document.getElementById('error');
  if (errorDiv) {
    const errorMessage = errorDiv.querySelector('.alert-content p');
    if (errorMessage) errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
    errorDiv.scrollIntoView({ behavior: 'smooth' });
  }
}

function hideMessages() {
  const error = document.getElementById('error');
  const results = document.getElementById('results');
  if (error) error.classList.add('hidden');
  if (results) results.classList.add('hidden');
}

function showResults(data) {
  const resultsDiv = document.getElementById('results');
  if (!resultsDiv) return;
  
  resultsDiv.innerHTML = 
    '<div class="results-header">' +
      '<h2><i class="fas fa-file-alt"></i> Resultados de la Búsqueda</h2>' +
      '<div class="search-summary">' +
        '<p><strong>Tipo:</strong> ' + (data.tipoPersona === 'natural' ? 'Persona Natural' : 'Persona Jurídica') + '</p>' +
        '<p><strong>Búsqueda:</strong> ' + data.searchInfo + '</p>' +
        '<p><strong>Competencia:</strong> ' + data.competencia + '</p>' +
        (data.tribunal ? '<p><strong>Tribunal:</strong> ' + data.tribunal + '</p>' : '') +
        (data.corte ? '<p><strong>Corte:</strong> ' + data.corte + '</p>' : '') +
        '<p><strong>Año:</strong> ' + data.año + '</p>' +
        '<p><strong>Fecha:</strong> ' + new Date(data.timestamp).toLocaleString('es-CL') + '</p>' +
      '</div>' +
    '</div>' +
    '<div class="results-content">' +
      '<div class="result-column">' +
        '<h3><i class="fas fa-file-text"></i> Datos Originales</h3>' +
        '<div class="raw-data">' +
          '<pre>' + data.rawData + '</pre>' +
        '</div>' +
      '</div>' +
      '<div class="result-column">' +
        '<h3><i class="fas fa-robot"></i> Explicación Simple</h3>' +
        '<div class="translated-data">' +
          data.translation.replace(/\n/g, '<br>') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="results-actions">' +
      '<button onclick="window.print()" class="btn-secondary">' +
        '<i class="fas fa-print"></i> Imprimir' +
      '</button>' +
      '<button onclick="nuevaBusqueda()" class="btn-primary">' +
        '<i class="fas fa-search"></i> Nueva Búsqueda' +
      '</button>' +
    '</div>';
  
  resultsDiv.classList.remove('hidden');
  resultsDiv.scrollIntoView({ behavior: 'smooth' });
}

function nuevaBusqueda() {
  hideMessages();
  const form = document.getElementById('form-busqueda-nombre');
  if (form) {
    form.reset();
    // Resetear a persona natural por defecto
    const naturalRadio = document.querySelector('input[name="tipo-persona"][value="natural"]');
    if (naturalRadio) naturalRadio.checked = true;
    
    const camposPersonaNatural = document.getElementById('campos-persona-natural');  
    const camposPersonaJuridica = document.getElementById('campos-persona-juridica');
    const camposDependientes = document.getElementById('campos-dependientes');
    
    if (camposPersonaNatural) camposPersonaNatural.style.display = 'block';
    if (camposPersonaJuridica) camposPersonaJuridica.style.display = 'none';
    if (camposDependientes) camposDependientes.style.display = 'none';
  }
}