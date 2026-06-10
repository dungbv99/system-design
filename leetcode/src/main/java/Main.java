import java.util.*;

import java

public class Main {
  public static void main(String[] args) {
    System.out.println();

  }

  public int[] pivotArray(int[] nums, int pivot) {
    int[] ans = new int[nums.length];
    int i = 0;
    int j = nums.length - 1;
    for (int idx = 0; idx < nums.length; idx++) {
      if (nums[idx] < pivot) {
        ans[i] = nums[idx];
        i++;
      }
    }

    for (int idx = nums.length - 1; idx >= 0; idx--){
      if(nums[idx] > pivot){
        ans[j] = nums[idx];
        j--;
      }
    }

    while (i <= j){
      ans[i] = pivot;
      i++;
    }
    return ans;
  }

}
