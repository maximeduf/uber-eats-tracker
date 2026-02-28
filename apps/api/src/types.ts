export interface OrderRecord {
  id: number;
  restaurantName: string;
  totalPrice: number;
  orderedAtText: string;
  sourceSignature: string;
  createdAt: string;
}

export interface CreateOrderPayload {
  restaurantName: string;
  totalPrice: number;
  orderedAtText: string;
  sourceSignature: string;
}
