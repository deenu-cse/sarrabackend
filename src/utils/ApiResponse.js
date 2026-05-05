class ApiResponse {
  constructor(statusCode, data, message = 'Success', pagination = null) {
    this.success = statusCode < 400;
    this.message = message;
    this.data = data;
    if (pagination) {
      this.pagination = pagination;
    }
  }
}

export default ApiResponse;
