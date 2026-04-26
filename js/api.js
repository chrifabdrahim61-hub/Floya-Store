(function () {
  async function request(path, options) {
    const token = sessionStorage.getItem("floya_admin_token");
    const headers = {
      "Content-Type": "application/json",
      ...(options && options.headers ? options.headers : {})
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(path, {
      ...options,
      headers
    });

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error((data && data.error) || "Request failed");
    }

    return data;
  }

  window.api = {
    getProducts() {
      return request("/api/products", { method: "GET" });
    },
    createOrder(payload) {
      return request("/api/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    },
    login(username, password) {
      return request("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
    },
    getProfile() {
      return request("/api/admin/profile", { method: "GET" });
    },
    changePassword(currentPassword, newPassword) {
      return request("/api/admin/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
    },
    getOrders() {
      return request("/api/admin/orders", { method: "GET" });
    },
    createProduct(payload) {
      return request("/api/admin/products", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    },
    updateProduct(id, payload) {
      return request(`/api/admin/products/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    },
    deleteProduct(id) {
      return request(`/api/admin/products/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
    },
    updateOrderStatus(id, status) {
      return request(`/api/admin/orders/${encodeURIComponent(id)}/status`, {
        method: "PUT",
        body: JSON.stringify({ status })
      });
    }
  };
}());
