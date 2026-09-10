document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const message = document.querySelector('#login-error');
  button.disabled = true;
  message.hidden = true;
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexo-Request': '1' }, body: JSON.stringify({ token: document.querySelector('#token').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    location.assign('/');
  } catch (error) { message.textContent = error.message; message.hidden = false; }
  finally { button.disabled = false; }
});
