// sliders.js - Loads slider modal template (sliders.html) and exposes a small API to show sliders for a given effect
(async function(){
  const modal = document.getElementById('slidersModal');
  const resp = await fetch('sliders.html');
  const html = await resp.text();
  modal.innerHTML = html;

  const modalTitle = modal.querySelector('#modalTitle');
  const modalBody = modal.querySelector('#modalBody');
  const closeBtn = modal.querySelector('#closeModalBtn');
  const applyBtn = modal.querySelector('#applyParamsBtn');

  let currentEffect = null;
  let onApply = null;

  closeBtn.addEventListener('click', ()=>{ hideModal(); });

  function showModal(effectName, params, callback){
    currentEffect = effectName;
    onApply = callback;
    modalTitle.textContent = `Parameters — ${effectName}`;
    modalBody.innerHTML = '';

    for(const [key, p] of Object.entries(params||{})){
      const row = document.createElement('div');
      row.className = 'slider-row';
      const label = document.createElement('label');
      label.textContent = `${p.label || key} (${p.value})`;
      label.setAttribute('data-key', key);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = p.min ?? 0;
      input.max = p.max ?? 1;
      input.step = p.step ?? 0.01;
      input.value = p.value;
      input.dataset.key = key;

      input.addEventListener('input', (e)=>{
        label.textContent = `${p.label || key} (${e.target.value})`;
      });

      row.appendChild(label);
      row.appendChild(input);
      modalBody.appendChild(row);
    }

    modal.classList.remove('hidden');
  }

  function hideModal(){
    modal.classList.add('hidden');
    currentEffect = null;
    onApply = null;
  }

  applyBtn.addEventListener('click', ()=>{
    if(!onApply) return hideModal();
    const inputs = modalBody.querySelectorAll('input[type="range"]');
    const values = {};
    inputs.forEach(inp=>{
      const k = inp.dataset.key;
      values[k] = parseFloat(inp.value);
    });
    onApply(values);
    hideModal();
  });

  // Expose to window so app.js can call
  window.SlidersUI = {
    show: showModal,
    hide: hideModal
  };
})();
