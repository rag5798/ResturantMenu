// Sample menu data with restaurant items
const menuData = {
  categories: [
    {
      id: 1,
      name: "Appetizers",
      items: [
        {
          id: "app_001",
          name: "Garlic Bread",
          description: "Toasted bread with garlic and herbs",
          price: 5.99,
          image: "garlic-bread.jpg"
        },
        {
          id: "app_002",
          name: "Bruschetta",
          description: "Crispy bread topped with tomatoes and basil",
          price: 7.99,
          image: "bruschetta.jpg"
        }
      ]
    },
    {
      id: 2,
      name: "Main Courses",
      items: [
        {
          id: "main_001",
          name: "Spaghetti Carbonara",
          description: "Classic Italian pasta with cream and bacon",
          price: 14.99,
          image: "carbonara.jpg"
        },
        {
          id: "main_002",
          name: "Grilled Chicken Breast",
          description: "Herb-marinated chicken with seasonal vegetables",
          price: 16.99,
          image: "chicken.jpg"
        },
        {
          id: "main_003",
          name: "Salmon Fillet",
          description: "Fresh salmon with lemon butter sauce",
          price: 19.99,
          image: "salmon.jpg"
        }
      ]
    },
    {
      id: 3,
      name: "Desserts",
      items: [
        {
          id: "dessert_001",
          name: "Chocolate Lava Cake",
          description: "Warm chocolate cake with molten center",
          price: 8.99,
          image: "lava-cake.jpg"
        },
        {
          id: "dessert_002",
          name: "Tiramisu",
          description: "Traditional Italian dessert with mascarpone",
          price: 7.99,
          image: "tiramisu.jpg"
        }
      ]
    }
  ]
};

module.exports = menuData;
